'use client';

import {
  DURATION_CAP_LABELS,
  DURATION_CAPS,
  FREE_DURATION_CAPS,
  MAX_POST_IMAGES,
  canUseDurationCap,
  type DurationCap,
} from '@voiceout/shared';
import { ImagePlus, Loader2, Mic, Pause, Play, Square, Trash2, X } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { api, uploadAudio, uploadPostImage } from '@/lib/api';
import { useRequireAuth } from '@/lib/auth';
import { startOpusRecording, warmupOpus, type OpusHandle } from '@/lib/recordOpus';
import { usePlayer } from '@/lib/player';
import { WaveformPlayer } from '@/components/WaveformPlayer';
import { VoiceStudio } from '@/components/VoiceStudio';

type Phase = 'idle' | 'starting' | 'recording' | 'paused' | 'stopping' | 'posting';

export default function RecordPage() {
  return (
    <Suspense>
      <RecordPageInner />
    </Suspense>
  );
}

function RecordPageInner() {
  const { user, loading } = useRequireAuth();
  const { pause: pausePlayback } = usePlayer();
  const router = useRouter();
  const searchParams = useSearchParams();
  const studioPlan = Boolean(user?.isStudio);
  const caps = studioPlan ? DURATION_CAPS : FREE_DURATION_CAPS;
  const [cap, setCap] = useState<DurationCap>(60);
  const [caption, setCaption] = useState(() => searchParams.get('caption')?.slice(0, 500) ?? '');
  const [phase, setPhase] = useState<Phase>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [levels, setLevels] = useState<number[]>(() => Array(24).fill(0.12));
  const [images, setImages] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const recRef = useRef<OpusHandle | null>(null);
  const timer = useRef<number | null>(null);
  const capRef = useRef(cap);
  const elapsedRef = useRef(0);
  const frozenMs = useRef(0);
  const runStarted = useRef(0);
  const phaseRef = useRef<Phase>('idle');
  const transcriptRef = useRef('');
  const discardRef = useRef(false);
  capRef.current = cap;
  phaseRef.current = phase;

  const live = phase === 'recording' || phase === 'paused';
  const locked = phase === 'starting' || phase === 'stopping' || phase === 'posting';

  useEffect(() => {
    void warmupOpus();
    pausePlayback();
  }, [pausePlayback]);

  useEffect(() => {
    setCap((current) => (canUseDurationCap(current, studioPlan) ? current : 60));
  }, [studioPlan]);

  useEffect(() => {
    const urls = images.map((file) => URL.createObjectURL(file));
    setPreviews(urls);
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [images]);

  useEffect(() => {
    return () => {
      recRef.current?.stop();
      if (timer.current) window.clearInterval(timer.current);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function clearTimer() {
    if (timer.current) {
      window.clearInterval(timer.current);
      timer.current = null;
    }
  }

  function readElapsed() {
    const extra = phaseRef.current === 'paused' ? 0 : Date.now() - runStarted.current;
    return frozenMs.current + extra;
  }

  function clearTake() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setBlob(null);
    setPreviewBlob(null);
    setPreviewUrl(null);
    setDurationMs(0);
    setElapsed(0);
    elapsedRef.current = 0;
    frozenMs.current = 0;
  }

  async function start() {
    if (phaseRef.current !== 'idle') return;
    phaseRef.current = 'starting';
    setPhase('starting');
    setError(null);
    discardRef.current = false;
    clearTake();
    try {
      const handle = await startOpusRecording({
        onLevel: setLevels,
        onStop: (file) => {
          clearTimer();
          recRef.current = null;
          if (discardRef.current) {
            discardRef.current = false;
            setPhase('idle');
            return;
          }
          const measured = elapsedRef.current;
          setBlob(file);
          setPreviewBlob(file);
          setDurationMs(measured);
          setPreviewUrl(URL.createObjectURL(file));
          setPhase('idle');
        },
      });
      recRef.current = handle;
    } catch (err) {
      console.error(err);
      setPhase('idle');
      setError(err instanceof Error ? err.message : 'Could not use the mic');
      return;
    }
    frozenMs.current = 0;
    runStarted.current = Date.now();
    elapsedRef.current = 0;
    transcriptRef.current = '';
    setElapsed(0);
    setPhase('recording');
    timer.current = window.setInterval(() => {
      const ms = readElapsed();
      elapsedRef.current = ms;
      setElapsed(ms);
      setDurationMs(ms);
      if (ms >= capRef.current * 1000) stop();
    }, 50);
  }

  function pause() {
    if (phaseRef.current !== 'recording') return;
    frozenMs.current = readElapsed();
    phaseRef.current = 'paused';
    recRef.current?.pause();
    setPhase('paused');
  }

  function resume() {
    if (phaseRef.current !== 'paused') return;
    runStarted.current = Date.now();
    phaseRef.current = 'recording';
    recRef.current?.resume();
    setPhase('recording');
  }

  function stop() {
    if (phaseRef.current !== 'recording' && phaseRef.current !== 'paused') return;
    elapsedRef.current = readElapsed();
    phaseRef.current = 'stopping';
    setPhase('stopping');
    recRef.current?.stop();
  }

  function discard() {
    if (live || phase === 'stopping') {
      discardRef.current = true;
      stop();
      clearTake();
      return;
    }
    clearTake();
  }

  async function publish() {
    if (phaseRef.current === 'posting' || !(previewBlob || blob) || !caption.trim()) {
      if (!caption.trim()) setError('Add a caption');
      return;
    }
    phaseRef.current = 'posting';
    setPhase('posting');
    setError(null);
    try {
      const audio = previewBlob || blob!;
      const ms = Math.min(durationMs || elapsedRef.current, cap * 1000 + 1500);
      const mediaId = await uploadAudio('post_audio', audio, cap);
      const imageIds: string[] = [];
      for (const file of images) {
        imageIds.push(await uploadPostImage(file));
      }
      const created = await api<{ post: { id: string } }>('/posts', {
        method: 'POST',
        body: JSON.stringify({
          caption: caption.trim(),
          mediaId,
          imageIds,
          durationCap: cap,
          durationMs: Math.max(ms, 400),
          transcript: transcriptRef.current || undefined,
        }),
      });
      router.push(`/post/${created.post.id}`);
    } catch (err) {
      setPhase('idle');
      setError(err instanceof Error ? err.message : 'Could not post');
    }
  }

  if (loading || !user) {
    return <p className="p-6 text-sm text-[var(--muted)]">Checking your session.</p>;
  }

  return (
    <div className="px-4 py-6">
      <h1 className="text-xl font-bold">Record</h1>
      <div className="mt-4 grid grid-cols-3 gap-2">
        {caps.map((c) => (
          <button
            key={c}
            type="button"
            disabled={live || locked}
            onClick={() => {
              setError(null);
              setCap(c);
            }}
            className={`min-h-11 rounded-2xl text-sm font-semibold disabled:opacity-40 ${
              cap === c ? 'bg-accent text-white' : 'border border-[var(--line)]'
            }`}
          >
            {DURATION_CAP_LABELS[c]}
          </button>
        ))}
      </div>
      <div className="mt-8 flex flex-col items-center gap-4">
        <div className="font-mono text-4xl font-bold tabular-nums">
          {formatMs(elapsed)}
          <span className="text-lg font-semibold text-[var(--muted)]"> / {formatMs(cap * 1000)}</span>
        </div>
        <div className="flex h-16 w-full max-w-sm items-end gap-1">
          {levels.map((lv, i) => (
            <span
              key={i}
              className="flex-1 rounded-full bg-accent"
              style={{ height: `${Math.max(8, Math.round(lv * 64))}px`, opacity: phase === 'recording' ? 1 : 0.35 }}
            />
          ))}
        </div>
        <div className="flex items-center justify-center gap-4">
          {!live && phase !== 'stopping' ? (
            <button
              type="button"
              aria-label="Start recording"
              disabled={locked}
              onClick={() => void start()}
              className="grid h-20 w-20 place-items-center rounded-full bg-red-500 text-white shadow-lg disabled:opacity-50"
            >
              {phase === 'starting' ? <Loader2 size={32} className="animate-spin" /> : <Mic size={32} strokeWidth={2.75} />}
            </button>
          ) : (
            <>
              <button
                type="button"
                aria-label={phase === 'paused' ? 'Continue recording' : 'Pause recording'}
                disabled={phase === 'stopping'}
                onClick={() => (phase === 'paused' ? resume() : pause())}
                className="grid h-14 w-14 place-items-center rounded-full border border-[var(--line)] bg-[var(--card)] disabled:opacity-50"
              >
                {phase === 'paused' ? <Play size={22} strokeWidth={2.75} /> : <Pause size={22} strokeWidth={2.75} />}
              </button>
              <button
                type="button"
                aria-label="Stop recording"
                disabled={phase === 'stopping'}
                onClick={stop}
                className="grid h-20 w-20 place-items-center rounded-full bg-ink-900 text-white disabled:opacity-50"
              >
                {phase === 'stopping' ? <Loader2 size={28} className="animate-spin" /> : <Square size={28} strokeWidth={2.75} />}
              </button>
              <button
                type="button"
                aria-label="Delete recording"
                disabled={phase === 'stopping'}
                onClick={discard}
                className="grid h-14 w-14 place-items-center rounded-full border border-[var(--line)] bg-[var(--card)] text-red-600 disabled:opacity-50"
              >
                <Trash2 size={22} strokeWidth={2.5} />
              </button>
            </>
          )}
        </div>
        {phase === 'paused' ? <p className="text-sm font-medium text-[var(--muted)]">Paused</p> : null}
            {blob && previewUrl && phase === 'idle' ? (
          <div className="mt-2 w-full">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <WaveformPlayer src={previewUrl} durationMs={durationMs || elapsed} trackId="record-preview" />
              </div>
              <button
                type="button"
                aria-label="Delete recording"
                className="grid h-14 w-14 shrink-0 place-items-center rounded-full border border-[var(--line)] text-red-600"
                onClick={discard}
              >
                <Trash2 size={22} strokeWidth={2.5} />
              </button>
            </div>
            <VoiceStudio
              sourceBlob={blob}
              disabled={locked}
              onApply={(next, ms) => {
                if (previewUrl) URL.revokeObjectURL(previewUrl);
                setPreviewBlob(next);
                setPreviewUrl(URL.createObjectURL(next));
                setDurationMs(ms);
                setElapsed(ms);
              }}
            />
          </div>
        ) : null}
      </div>
      <textarea
        className="mt-6 w-full rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3 text-base"
        rows={3}
        maxLength={500}
        placeholder="Add a caption"
        value={caption}
        onChange={(e) => setCaption(e.target.value)}
        disabled={phase === 'posting'}
      />
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
      <div className="mt-4">
        {previews.length > 0 ? (
          <div className={`mb-3 overflow-hidden rounded-xl ${previews.length > 1 ? 'grid grid-cols-2 gap-1' : ''}`}>
            {previews.map((src, i) => (
              <div key={src} className="relative">
                <img src={src} alt="" className="max-h-48 w-full object-cover" />
                <button
                  type="button"
                  aria-label="Remove image"
                  disabled={phase === 'posting'}
                  className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full bg-black/60 text-white disabled:opacity-50"
                  onClick={() => setImages((cur) => cur.filter((_, j) => j !== i))}
                >
                  <X size={16} strokeWidth={2.5} />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        {images.length < MAX_POST_IMAGES ? (
          <label className={`inline-flex min-h-11 items-center gap-2 rounded-full border border-[var(--line)] px-4 text-sm font-semibold ${phase === 'posting' ? 'pointer-events-none opacity-40' : 'cursor-pointer'}`}>
            <ImagePlus size={18} strokeWidth={2.5} />
            Photo
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              disabled={phase === 'posting'}
              onChange={(e) => {
                const picked = Array.from(e.target.files ?? []).filter((file) => file.type.startsWith('image/'));
                setImages((cur) => [...cur, ...picked].slice(0, MAX_POST_IMAGES));
                e.target.value = '';
              }}
            />
          </label>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => void publish()}
        className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-accent font-semibold text-white disabled:opacity-50"
        disabled={!(previewBlob || blob) || !caption.trim() || locked || live}
      >
        {phase === 'posting' ? <Loader2 size={18} className="animate-spin" /> : null}
        {phase === 'posting' ? 'Posting' : 'Post'}
      </button>
    </div>
  );
}

function formatMs(ms: number) {
  const s = Math.floor(Math.max(0, ms) / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toString().padStart(2, '0')}`;
}
