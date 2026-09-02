'use client';

import type { ReportSubmission, ReportSubmissionResult } from '@voiceout/shared';
import { FormEvent, useEffect, useId, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { buildReportPayload } from '@/lib/safetyState';

export function ReportDialog({
  targetType,
  targetId,
  targetLabel,
  onClose,
}: {
  targetType: ReportSubmission['targetType'];
  targetId: string;
  targetLabel: string;
  onClose: () => void;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [reason, setReason] = useState<ReportSubmission['reason']>('spam');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab') return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), select:not([disabled]), textarea:not([disabled])',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = oldOverflow;
      previous?.focus();
    };
  }, [onClose]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api<ReportSubmissionResult>('/reports', {
        method: 'POST',
        body: JSON.stringify(buildReportPayload(targetType, targetId, reason, details)),
      });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send report');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="w-full rounded-t-3xl bg-[var(--card)] p-5 shadow-xl sm:max-w-md sm:rounded-3xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id={titleId} className="text-lg font-bold">Report {targetLabel}</h2>
            <p id={descriptionId} className="mt-1 text-sm text-[var(--muted)]">
              Abuse reports are reviewed for safety. This is separate from feed preferences.
            </p>
          </div>
          <button ref={closeRef} type="button" aria-label="Close report dialog" className="min-h-10 px-2 text-sm" onClick={onClose}>
            Close
          </button>
        </div>
        {sent ? (
          <div role="status" className="mt-5">
            <p className="font-semibold">Report received</p>
            <p className="mt-1 text-sm text-[var(--muted)]">Thank you for helping keep VoiceOut safe.</p>
            <button type="button" className="mt-5 min-h-11 rounded-full bg-accent px-5 text-sm font-semibold text-white" onClick={onClose}>
              Done
            </button>
          </div>
        ) : (
          <form className="mt-5 space-y-4" onSubmit={(event) => void submit(event)}>
            <label className="block text-sm font-medium">
              Reason
              <select className="mt-1 min-h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3 text-base" value={reason} onChange={(event) => setReason(event.target.value as ReportSubmission['reason'])}>
                <option value="spam">Spam</option>
                <option value="abuse">Abuse or harassment</option>
                <option value="illegal">Illegal content</option>
                <option value="other">Other safety concern</option>
              </select>
            </label>
            <label className="block text-sm font-medium">
              Short details (optional)
              <textarea className="mt-1 min-h-24 w-full rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3 text-base" maxLength={500} value={details} onChange={(event) => setDetails(event.target.value)} />
              <span className="mt-1 block text-right text-xs text-[var(--muted)]">{details.length}/500</span>
            </label>
            {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
            <button disabled={busy} className="min-h-11 rounded-full bg-red-600 px-5 text-sm font-semibold text-white disabled:opacity-50" type="submit">
              {busy ? 'Sending report' : 'Send report'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
