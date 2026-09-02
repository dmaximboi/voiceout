'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import { mediaDurationSec } from './audioPeaks';
import { claimPlayback, registerPlayerPause } from './audioGate';
import { emitFeedEvent } from './feedEvents';

export type Track = {
  id: string;
  src: string;
  durationMs: number;
};

type PlayerCtx = {
  track: Track | null;
  playing: boolean;
  progress: number;
  duration: number;
  currentMs: number;
  play: (track: Track) => void;
  pause: () => void;
  stop: () => void;
  toggle: () => void;
  seekRatio: (ratio: number) => void;
  reportDuration: (trackId: string, durationMs: number) => void;
};

const Ctx = createContext<PlayerCtx | null>(null);

function tryPlay(el: HTMLAudioElement, onOk: () => void, onFail?: () => void) {
  void el
    .play()
    .then(onOk)
    .catch((err: unknown) => {
      const name = err instanceof DOMException ? err.name : '';
      if (name === 'NotAllowedError') {
        const resume = () => {
          void el.play().then(onOk).catch(() => onFail?.());
          window.removeEventListener('pointerdown', resume);
        };
        window.addEventListener('pointerdown', resume, { once: true });
        return;
      }
      onFail?.();
    });
}

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const listenedRef = useRef(0);
  const lastTickRef = useRef(0);
  const decodedMsRef = useRef(0);
  const [track, setTrack] = useState<Track | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentMs, setCurrentMs] = useState(0);
  const trackRef = useRef<Track | null>(null);
  const playingRef = useRef(false);
  trackRef.current = track;
  playingRef.current = playing;

  const flushListen = useCallback(() => {
    const current = trackRef.current;
    const ms = Math.round(listenedRef.current * 1000);
    listenedRef.current = 0;
    if (!current || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(current.id) || ms < 400) return;
    void api('/feed/listen', {
      method: 'POST',
      body: JSON.stringify({ postId: current.id, listenedMs: ms, durationMs: decodedMsRef.current || current.durationMs }),
    }).catch(() => undefined);
  }, []);

  const durationSec = useCallback((el: HTMLAudioElement) => {
    const decoded = decodedMsRef.current / 1000;
    const native = mediaDurationSec(el, decodedMsRef.current || trackRef.current?.durationMs || 0);
    if (decoded > 0 && (!native || native > decoded * 1.2 || !Number.isFinite(el.duration))) return decoded;
    return native;
  }, []);

  const syncProgress = useCallback(
    (el: HTMLAudioElement) => {
      const now = el.currentTime;
      if (playingRef.current && now > lastTickRef.current) listenedRef.current += now - lastTickRef.current;
      lastTickRef.current = now;
      const dur = durationSec(el);
      if (dur > 0) {
        setProgress(Math.min(1, now / dur));
        setDuration(dur * 1000);
        setCurrentMs(now * 1000);
      }
    },
    [durationSec],
  );

  const loadSrc = useCallback((el: HTMLAudioElement, src: string) => {
    if (el.getAttribute('src') === src && el.readyState >= 2) return;
    el.removeAttribute('src');
    el.src = src;
    el.load();
  }, []);

  const play = useCallback(
    (next: Track) => {
      const el = audioRef.current;
      if (!el || !next.src) return;
      claimPlayback();
      if (trackRef.current?.id === next.id && el.getAttribute('src') === next.src) {
        tryPlay(el, () => setPlaying(true), () => setPlaying(false));
        return;
      }
      flushListen();
      decodedMsRef.current = next.durationMs > 0 && next.durationMs < 30 * 60 * 1000 ? next.durationMs : 0;
      setTrack(next);
      setProgress(0);
      setCurrentMs(0);
      setDuration(next.durationMs);
      loadSrc(el, next.src);
      tryPlay(el, () => {
        setPlaying(true);
        emitFeedEvent({ eventType: 'play', postId: next.id, source: 'player' });
      }, () => setPlaying(false));
    },
    [flushListen, loadSrc],
  );

  const pause = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (playingRef.current) {
      el.pause();
      setPlaying(false);
      flushListen();
    }
  }, [flushListen]);

  const stop = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    el.pause();
    el.removeAttribute('src');
    el.load();
    setPlaying(false);
    setTrack(null);
    setProgress(0);
    setCurrentMs(0);
    setDuration(0);
    flushListen();
  }, [flushListen]);

  const toggle = useCallback(() => {
    const el = audioRef.current;
    if (!el || !trackRef.current) return;
    if (playingRef.current) {
      pause();
    } else {
      claimPlayback();
      tryPlay(el, () => setPlaying(true), () => setPlaying(false));
    }
  }, [pause]);

  const seekRatio = useCallback(
    (ratio: number) => {
      const el = audioRef.current;
      if (!el) return;
      const dur = durationSec(el);
      if (!dur) return;
      el.currentTime = Math.min(dur * 0.999, Math.max(0, ratio * dur));
      syncProgress(el);
    },
    [durationSec, syncProgress],
  );

  const reportDuration = useCallback((trackId: string, durationMs: number) => {
    if (!durationMs || durationMs <= 0) return;
    if (trackRef.current?.id !== trackId) return;
    decodedMsRef.current = durationMs;
    setDuration(durationMs);
    const el = audioRef.current;
    if (el) syncProgress(el);
  }, [syncProgress]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTime = () => syncProgress(el);
    const onEnd = () => {
      setPlaying(false);
      setProgress(1);
      const dur = durationSec(el);
      setCurrentMs(dur * 1000);
      flushListen();
      const current = trackRef.current;
      if (current) emitFeedEvent({ eventType: 'complete', postId: current.id, source: 'player' });
    };
    const onPlay = () => {
      lastTickRef.current = el.currentTime;
      setPlaying(true);
    };
    const onPause = () => setPlaying(false);
    const onError = () => setPlaying(false);
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('durationchange', onTime);
    el.addEventListener('ended', onEnd);
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('loadedmetadata', onTime);
    el.addEventListener('error', onError);
    return () => {
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('durationchange', onTime);
      el.removeEventListener('ended', onEnd);
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('loadedmetadata', onTime);
      el.removeEventListener('error', onError);
    };
  }, [durationSec, flushListen, syncProgress]);

  useEffect(() => {
    if (!playing) return;
    const el = audioRef.current;
    let raf = 0;
    const tick = () => {
      if (el) syncProgress(el);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, syncProgress]);

  useEffect(() => {
    return registerPlayerPause(() => {
      const el = audioRef.current;
      if (!el) return;
      if (!playingRef.current && !trackRef.current) return;
      el.pause();
      setPlaying(false);
      flushListen();
    });
  }, [flushListen]);

  useEffect(() => {
    return () => flushListen();
  }, [flushListen]);

  const value = useMemo<PlayerCtx>(
    () => ({
      track,
      playing,
      progress,
      duration: duration || (track?.durationMs ?? 0),
      currentMs,
      play,
      pause,
      stop,
      toggle,
      seekRatio,
      reportDuration,
    }),
    [track, playing, progress, duration, currentMs, play, pause, stop, toggle, seekRatio, reportDuration],
  );

  return (
    <Ctx.Provider value={value}>
      <audio
        ref={audioRef}
        preload="auto"
        playsInline
        className="pointer-events-none fixed h-px w-px overflow-hidden opacity-0"
      />
      {children}
    </Ctx.Provider>
  );
}

export function usePlayer() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('usePlayer');
  return ctx;
}

