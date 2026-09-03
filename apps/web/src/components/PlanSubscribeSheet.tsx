'use client';

import type { PlanTier } from '@voiceout/shared';
import { PLAN_DEFINITIONS, comparePlanTier, planList } from '@voiceout/shared';
import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';

export function PlanSubscribeSheet({
  open,
  currentTier,
  busyTier,
  onClose,
  onSelect,
}: {
  open: boolean;
  currentTier: PlanTier | null;
  busyTier: PlanTier | null;
  onClose: () => void;
  onSelect: (tier: PlanTier) => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const old = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = old;
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="plan-sheet-title"
        className="flex h-full w-full max-w-md flex-col bg-[var(--card)] shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
          <h2 id="plan-sheet-title" className="text-lg font-bold">
            Choose a plan
          </h2>
          <button ref={closeRef} type="button" aria-label="Close" className="min-h-10 min-w-10 rounded-full" onClick={onClose}>
            <X className="mx-auto h-5 w-5" />
          </button>
        </div>
        <p className="px-4 pt-3 text-sm text-[var(--muted)]">30 days per purchase. Upgrades apply immediately.</p>
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {planList().map(({ tier, priceLabel, title, benefits }) => {
            const owned = currentTier && comparePlanTier(currentTier, tier) >= 0;
            const def = PLAN_DEFINITIONS[tier];
            return (
              <div key={tier} className="rounded-2xl border border-[var(--line)] p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-base font-semibold">{title}</h3>
                  <span className="text-lg font-bold">{priceLabel}</span>
                </div>
                <ul className="mt-2 space-y-1 text-sm text-[var(--muted)]">
                  {benefits.map((b) => (
                    <li key={b}>• {b}</li>
                  ))}
                </ul>
                <button
                  type="button"
                  disabled={Boolean(owned) || busyTier !== null}
                  onClick={() => onSelect(tier)}
                  className="mt-4 flex min-h-11 w-full items-center justify-center rounded-full bg-accent text-sm font-semibold text-white disabled:opacity-50"
                >
                  {owned ? 'Current plan' : busyTier === tier ? 'Opening checkout…' : `Subscribe ${priceLabel}`}
                </button>
                {tier === 'gold' ? (
                  <p className="mt-2 text-xs text-[var(--muted)]">Up to {def.maxCaptionLength} characters on posts and comments.</p>
                ) : null}
              </div>
            );
          })}
        </div>
      </aside>
    </div>
  );
}
