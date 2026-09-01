'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { audioPeaks } from '@/lib/audioPeaks';
import { usePlayer } from '@/lib/player';

export function WaveformPlayer({
  src,
  durationMs,
  trackId,
}: {
  src: string | null;
  durationMs: number;
  trackId?: string;
}) {
  const player = usePlayer();
  const waveRef = useRef<HTMLButtonElement | null>(null);
  const localRef = useRef<HTMLAudioElement | null>(null);
  const global = Boolean(trackId && src);
  const active = global && player.track?.id === trackId;
  const playing = global ? Boolean(active && player.playing) : false;
  const [localPlaying, setLocalPlaying] = useState(false);
  const [localProgress, setLocalProgress] = useState(0);
  const [localMs, setLocalMs] = useState(0);
  const [peaks, setPeaks] = useState<number[]>(() => Array.from({ length: 96 }, () => 0.2));
  const [actualMs, setActualMs] = useState(0);

  useEffect(() => {
    if (!src) return;
    void audioPeaks(src).then((result) => {
      setPeaks(result.peaks);
      if (result.durationMs > 0) {
        setActualMs(result.durationMs);
        const close = !durationMs || Math.abs(result.durationMs - durationMs) < 2000;
        if (trackId && close) player.reportDuration(trackId, result.durationMs);
      }
    });
  }, [src, trackId, durationMs]);

  useEffect(() => {
    const el = localRef.current;
    if (!el || global) return;
    const onTime = () => {
      const dur = Number.isFinite(el.duration) && el.duration > 0 && el.duration !== Infinity ? el.duration : actualMs / 1000;
      if (dur > 0) {
        setLocalProgress(Math.min(1, el.currentTime / dur));
        setLocalMs(el.currentTime * 1000);
      }
    };
    const onEnd = () => {
      setLocalPlaying(false);
      setLocalProgress(1);
    };
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('ended', onEnd);
    el.addEventListener('loadedmetadata', onTime);
    return () => {
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('ended', onEnd);
      el.removeEventListener('loadedmetadata', onTime);
    };
  }, [src, global, actualMs]);

  const progress = global && active ? player.progress : localProgress;
  const totalMs = durationMs > 0 ? durationMs : actualMs || (global && active ? player.duration : 0);
  const elapsedMs = global && active ? player.currentMs : localMs;
  const clip = useId().replace(/:/g, '');
  const path = useMemo(() => areaPath(peaks), [peaks]);

  function toggle() {
    if (!src) return;
    if (global && trackId) {
      if (active && player.playing) player.toggle();
      else player.play({ id: trackId, src, durationMs: actualMs || durationMs });
      return;
    }
    const el = localRef.current;
    if (!el) return;
    if (localPlaying) {
      el.pause();
      setLocalPlaying(false);
    } else {
      void el.play().then(() => setLocalPlaying(true)).catch(() => setLocalPlaying(false));
    }
  }

  function seek(clientX: number) {
    const wave = waveRef.current;
    if (!wave) return;
    const rect = wave.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    if (global && trackId && src) {
      if (!active) player.play({ id: trackId, src, durationMs: actualMs || durationMs });
      player.seekRatio(ratio);
      return;
    }
    const el = localRef.current;
    if (!el) return;
    const dur = Number.isFinite(el.duration) && el.duration > 0 && el.duration !== Infinity ? el.duration : totalMs / 1000;
    if (!dur) return;
    el.currentTime = ratio * dur;
    setLocalProgress(ratio);
    setLocalMs(ratio * dur * 1000);
  }

  const isPlaying = global ? playing : localPlaying;

  return (
    <div className="relative flex min-w-0 items-center gap-2 rounded-2xl bg-[var(--bg)] px-2 py-2 sm:gap-3 sm:px-3">
      <button
        type="button"
        disabled={!src}
        onClick={toggle}
        className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-accent text-white active:scale-95 disabled:opacity-40"
      >
        {isPlaying ? <Pause size={18} strokeWidth={2.75} /> : <Play size={18} strokeWidth={2.75} />}
      </button>
      <button
        ref={waveRef}
        type="button"
        aria-label="Seek audio"
        disabled={!src}
        onClick={(e) => seek(e.clientX)}
        className="relative h-12 min-w-0 flex-1 overflow-hidden"
      >
        <svg viewBox="0 0 100 36" preserveAspectRatio="none" className="h-full w-full">
          <path d={path} fill="var(--line)" />
          <clipPath id={clip}>
            <rect x="0" y="0" width={Math.min(100, Math.max(0, progress * 100))} height="36" />
          </clipPath>
          <path d={path} fill="var(--accent)" clipPath={`url(#${clip})`} />
        </svg>
      </button>
      <span className="w-[4.25rem] shrink-0 text-right text-[11px] font-semibold tabular-nums text-[var(--muted)]">
        {fmt(elapsedMs)}/{fmt(totalMs)}
      </span>
      {src && !global ? (
        <audio ref={localRef} src={src} preload="auto" playsInline className="pointer-events-none absolute h-px w-px overflow-hidden opacity-0" />
      ) : null}
    </div>
  );
}

function areaPath(peaks: number[]) {
  if (peaks.length === 0) return 'M0 18 L100 18 Z';
  const mid = 18;
  const last = peaks.length - 1;
  let d = `M 0 ${mid}`;
  peaks.forEach((p, i) => {
    const x = (i / last) * 100;
    const y = mid - p * 16;
    d += ` L ${x.toFixed(2)} ${y.toFixed(2)}`;
  });
  for (let i = last; i >= 0; i--) {
    const x = (i / last) * 100;
    const y = mid + (peaks[i] ?? 0) * 16;
    d += ` L ${x.toFixed(2)} ${y.toFixed(2)}`;
  }
  return `${d} Z`;
}

function fmt(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}
