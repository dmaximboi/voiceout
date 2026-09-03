'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { applyVoiceStudio, DEFAULT_STUDIO, type StudioSettings } from '@/lib/voiceStudio';

/** Lightweight free studio: trim + boost; collapsed by default. */
export function VoiceStudio({
  sourceBlob,
  disabled,
  onApply,
}: {
  sourceBlob: Blob | null;
  disabled: boolean;
  onApply: (blob: Blob, durationMs: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<StudioSettings>(DEFAULT_STUDIO);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sourceRef = useRef<Blob | null>(sourceBlob);

  useEffect(() => {
    sourceRef.current = sourceBlob;
    setSettings(DEFAULT_STUDIO);
    setError(null);
  }, [sourceBlob]);

  function patch(partial: Partial<StudioSettings>) {
    setSettings((cur) => ({ ...cur, ...partial }));
  }

  async function run() {
    const source = sourceRef.current;
    if (!source) {
      setError('Record a take first');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const result = await applyVoiceStudio(source, settings);
      onApply(result.blob, result.durationMs);
    } catch {
      setError('Could not apply');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 rounded-2xl border border-[var(--line)]">
      <button
        type="button"
        className="flex min-h-11 w-full items-center justify-between px-4 text-sm font-semibold"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        Voice studio
        <ChevronDown className={`h-5 w-5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open ? (
        <div className="space-y-3 border-t border-[var(--line)] px-4 pb-4 pt-3">
          <Range label="Trim start" value={settings.trimStart} onChange={(v) => patch({ trimStart: v })} />
          <Range
            label="Trim end"
            value={settings.trimEnd}
            onChange={(v) => patch({ trimEnd: Math.max(v, settings.trimStart + 0.02) })}
          />
          <Range label="Boost" value={settings.boost} onChange={(v) => patch({ boost: v })} />
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <button
            type="button"
            className="min-h-11 w-full rounded-full border border-[var(--line)] text-sm font-semibold disabled:opacity-50"
            disabled={disabled || busy || !sourceBlob}
            onClick={() => void run()}
          >
            {busy ? 'Applying…' : 'Apply'}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Range({
  label,
  value,
  onChange,
  min = 0,
  max = 1,
  step = 0.01,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <label className="block text-xs font-medium text-[var(--muted)]">
      {label}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full"
      />
    </label>
  );
}
