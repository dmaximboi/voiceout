'use client';

import { ChevronRight, Mic } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PointerEvent, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { SPEAK_PROMPTS } from '@/lib/speakPrompts';

const THUMB = 44;
const INSET = 4;
const COMPLETE_AT = 0.88;

export function Composer() {
  const { user, loading } = useAuth();
  const router = useRouter();

  function goRecord() {
    if (!user) {
      router.push('/login');
      return;
    }
    router.push('/record');
  }

  if (loading) {
    return <div className="h-[4.5rem] border-b border-[var(--line)]" />;
  }

  if (!user) {
    return (
      <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-3 py-3 sm:px-4">
        <p className="text-sm text-[var(--muted)]">Log in to post a voice.</p>
        <Link href="/login" className="flex min-h-11 shrink-0 items-center rounded-full bg-accent px-4 text-sm font-semibold text-white active:opacity-80">
          Log in
        </Link>
      </div>
    );
  }

  return (
    <div className="border-b border-[var(--line)] px-3 py-3 sm:px-4">
      <SlideToSpeak onComplete={goRecord} />
    </div>
  );
}

function SlideToSpeak({ onComplete }: { onComplete: () => void }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const origin = useRef(0);
  const offset = useRef(0);
  const xRef = useRef(0);
  const [x, setX] = useState(0);
  const [snap, setSnap] = useState(true);
  const [promptIndex, setPromptIndex] = useState(0);
  const [promptOn, setPromptOn] = useState(true);

  useEffect(() => {
    const id = window.setInterval(() => {
      setPromptOn(false);
      window.setTimeout(() => {
        setPromptIndex((i) => (i + 1) % SPEAK_PROMPTS.length);
        setPromptOn(true);
      }, 280);
    }, 3800);
    return () => window.clearInterval(id);
  }, []);

  function maxTravel() {
    const w = trackRef.current?.clientWidth ?? 0;
    return Math.max(0, w - THUMB - INSET * 2);
  }

  function setPos(next: number) {
    xRef.current = next;
    setX(next);
  }

  function onDown(e: PointerEvent<HTMLButtonElement>) {
    dragging.current = true;
    origin.current = e.clientX;
    offset.current = xRef.current;
    setSnap(false);
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onMove(e: PointerEvent<HTMLButtonElement>) {
    if (!dragging.current) return;
    setPos(Math.min(maxTravel(), Math.max(0, offset.current + (e.clientX - origin.current))));
  }

  function onUp() {
    if (!dragging.current) return;
    dragging.current = false;
    const max = maxTravel();
    const moved = xRef.current;
    const done = max > 0 && moved / max >= COMPLETE_AT;
    const tapped = moved < 10;
    setSnap(true);
    if (done || tapped) {
      setPos(done ? max : 0);
      window.setTimeout(() => {
        onComplete();
        setPos(0);
      }, tapped ? 0 : 160);
    } else {
      setPos(0);
    }
  }

  const fill = maxTravel() > 0 ? x / maxTravel() : 0;
  const prompt = SPEAK_PROMPTS[promptIndex] ?? SPEAK_PROMPTS[0];

  return (
    <div
      ref={trackRef}
      className="relative h-14 overflow-hidden rounded-full bg-[var(--bg)]"
      style={{ touchAction: 'none' }}
    >
      <div
        className="absolute inset-y-0 left-0 rounded-full bg-accent/20"
        style={{ width: INSET * 2 + THUMB + x }}
      />
      <div
        className="pointer-events-none absolute inset-y-0 flex items-center pr-3 text-[11px] font-medium leading-tight text-[var(--muted)]"
        style={{
          left: INSET + THUMB + 10,
          right: 12,
          opacity: promptOn ? Math.max(0, 1 - fill * 1.5) : 0,
          transition: 'opacity 280ms ease',
        }}
      >
        <span className="min-w-0 flex-1 truncate">{prompt}</span>
        <ChevronRight size={12} strokeWidth={2} />
      </div>
      <button
        type="button"
        aria-label={prompt}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        className="absolute top-1/2 grid -translate-y-1/2 place-items-center rounded-full bg-accent text-white active:scale-95"
        style={{
          width: THUMB,
          height: THUMB,
          left: INSET + x,
          transition: snap ? 'left 220ms ease' : 'none',
        }}
      >
        <Mic size={20} strokeWidth={2} />
      </button>
    </div>
  );
}
