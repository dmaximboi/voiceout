'use client';

import { ChevronUp, Mic } from 'lucide-react';
import { PointerEvent, useRef, useState } from 'react';

const LOCK_AT = 72;

export function SlideUpMic({ onSpeak, docked }: { onSpeak: () => void; docked: boolean }) {
  const dragging = useRef(false);
  const startY = useRef(0);
  const liftRef = useRef(0);
  const [lift, setLift] = useState(0);
  const [locked, setLocked] = useState(false);

  function onDown(e: PointerEvent<HTMLButtonElement>) {
    dragging.current = true;
    startY.current = e.clientY;
    liftRef.current = 0;
    setLift(0);
    setLocked(false);
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onMove(e: PointerEvent<HTMLButtonElement>) {
    if (!dragging.current) return;
    const next = Math.max(0, Math.min(120, startY.current - e.clientY));
    liftRef.current = next;
    setLift(next);
    setLocked(next >= LOCK_AT);
  }

  function onUp() {
    if (!dragging.current) return;
    dragging.current = false;
    const liftNow = liftRef.current;
    const done = liftNow >= LOCK_AT;
    const tapped = liftNow < 16;
    setLift(0);
    setLocked(false);
    if (done || tapped) onSpeak();
  }

  return (
    <li
      className={`relative z-40 flex-none transition-all duration-300 ${
        docked ? 'w-14 opacity-100' : 'pointer-events-none w-0 overflow-hidden opacity-0'
      }`}
    >
      {docked && lift > 8 ? (
        <div
          className="pointer-events-none absolute bottom-12 left-1/2 flex -translate-x-1/2 flex-col items-center gap-1"
          style={{ transform: `translate(-50%, ${-lift}px)` }}
        >
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${locked ? 'bg-accent text-white' : 'bg-[var(--card)] text-[var(--muted)]'}`}>
            {locked ? 'Release to speak' : 'Slide up'}
          </span>
          <ChevronUp size={16} strokeWidth={2} className={locked ? 'text-accent' : 'text-[var(--muted)]'} />
        </div>
      ) : null}
      <button
        type="button"
        aria-label="Slide up to speak"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        className={`flex min-h-12 flex-col items-center justify-center gap-0.5 px-2 py-1.5 text-[11px] active:opacity-80 ${docked ? 'text-accent' : 'text-[var(--muted)]'}`}
        style={{ touchAction: 'none' }}
      >
        <span
          className="grid h-10 w-10 place-items-center rounded-full bg-accent text-white shadow-md"
          style={{
            transform: `translateY(${-Math.min(lift, LOCK_AT)}px) scale(${locked ? 1.08 : 1})`,
            transition: dragging.current ? 'none' : 'transform 180ms ease',
          }}
        >
          <Mic size={20} strokeWidth={2} />
        </span>
        Speak
      </button>
    </li>
  );
}
