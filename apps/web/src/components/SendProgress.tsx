'use client';

import { useProcessing } from '@/lib/useProcessing';

export function SendBar() {
  const sending = useProcessing();
  return (
    <div className={`send-bar ${sending ? 'send-bar-on' : ''}`} aria-hidden>
      {sending ? <span /> : null}
    </div>
  );
}

export function DropBalls() {
  return (
    <span className="drop-balls" aria-hidden>
      <span />
      <span />
      <span />
    </span>
  );
}
