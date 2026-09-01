'use client';

import { Eye, EyeOff } from 'lucide-react';
import { useState, type InputHTMLAttributes } from 'react';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

export function PasswordField({ className = '', disabled, ...props }: Props) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input
        {...props}
        disabled={disabled}
        type={visible ? 'text' : 'password'}
        className={`w-full min-h-11 rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3 pr-12 text-base disabled:opacity-60 ${className}`}
      />
      <button
        type="button"
        className="absolute right-0.5 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full text-[var(--muted)] active:bg-[var(--card)] disabled:opacity-40"
        onClick={() => setVisible((v) => !v)}
        disabled={disabled}
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
      >
        {visible ? <EyeOff size={20} strokeWidth={2.25} /> : <Eye size={20} strokeWidth={2.25} />}
      </button>
    </div>
  );
}
