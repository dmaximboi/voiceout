'use client';

import { api } from '@/lib/api';
import { useEffect, useState } from 'react';

type Providers = {
  email: boolean;
  google: boolean;
  telegram: boolean;
  telegramUsername?: string;
  telegramBotId?: string;
};

export function OAuthButtons({ next = '/' }: { next?: string }) {
  const [providers, setProviders] = useState<Providers | null>(null);
  useEffect(() => {
    void api<Providers>('/auth/providers').then(setProviders).catch(() => setProviders(null));
  }, []);
  const q = next && next !== '/' ? `?next=${encodeURIComponent(next)}` : '';
  const btn =
    'grid h-14 w-14 place-items-center rounded-full border border-[var(--line)] bg-[var(--card)] shadow-sm active:bg-[var(--bg)]';
  return (
    <div className="flex items-center justify-center gap-4">
      {providers?.google ? (
        <a className={btn} href={`/vo-api/auth/google${q}`} aria-label="Continue with Google">
          <GoogleMark />
        </a>
      ) : null}
      {providers?.telegram && providers.telegramUsername ? (
        <TelegramButton next={next} className={btn} />
      ) : null}
    </div>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

function TelegramMark() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
      <path
        fill="#2AABEE"
        d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"
      />
      <path
        fill="#fff"
        d="M16.64 8.14c.14-.62-.45-.92-.94-.72L6.9 11.2c-.6.23-.59.56-.1.7l2.43.76 5.63-3.55c.27-.18.51-.08.31.12l-4.56 4.12-.17 2.55c.24 0 .35-.11.48-.24l1.16-1.13 2.4 1.77c.44.24.76.12.87-.41l1.29-6.05z"
      />
    </svg>
  );
}

function TelegramButton({ next, className }: { next: string; className: string }) {
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState('');

  async function signIn() {
    setHint('');
    setBusy(true);
    try {
      const { id, url } = await api<{ id: string; url: string }>('/auth/telegram/start', {
        method: 'POST',
        body: JSON.stringify({ next }),
      });
      window.open(url, '_blank', 'noopener,noreferrer');
      setHint('Open Telegram and tap Start.');
      const deadline = Date.now() + 3 * 60 * 1000;
      while (Date.now() < deadline) {
        const wait = await api<{ status: 'pending' | 'expired' | 'done'; handoff?: string }>(
          `/auth/telegram/wait?id=${encodeURIComponent(id)}`,
        );
        if (wait.status === 'done' && wait.handoff) {
          window.location.assign(wait.handoff);
          return;
        }
        if (wait.status === 'expired') {
          setHint('That login expired. Tap Telegram again.');
          setBusy(false);
          return;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 3000));
      }
      setHint('Timed out. Tap Telegram and Start again.');
      setBusy(false);
    } catch {
      setHint('Could not start Telegram login.');
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        className={className}
        aria-label="Continue with Telegram"
        disabled={busy}
        onClick={() => void signIn()}
      >
        <TelegramMark />
      </button>
      {hint ? <p className="max-w-48 text-center text-xs text-[var(--muted)]">{hint}</p> : null}
    </div>
  );
}
