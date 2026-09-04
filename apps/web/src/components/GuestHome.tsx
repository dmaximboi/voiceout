'use client';

import Link from 'next/link';
import { Logo } from '@/components/Logo';

const promos = [
  {
    title: 'Speak first',
    body: 'Drop short voices with photos. No endless typing — just what you need to say.',
  },
  {
    title: 'Listen close',
    body: 'A ranked feed that surfaces people and voices near your language, place, and mood.',
  },
  {
    title: 'Stay in control',
    body: 'Follow, mute, report, and erase. Your account, your pace.',
  },
];

export function GuestHome() {
  return (
    <div className="relative overflow-hidden">
      <div
        className="pointer-events-none absolute inset-0 -z-10 opacity-90"
        style={{
          background:
            'radial-gradient(ellipse 80% 50% at 50% -10%, color-mix(in oklab, var(--accent) 22%, transparent), transparent 70%), linear-gradient(180deg, var(--bg), var(--card))',
        }}
      />
      <section className="mx-auto flex max-w-lg flex-col items-center px-5 pb-8 pt-10 text-center">
          <Logo size={64} />
        <h1 className="mt-5 text-3xl font-bold tracking-tight text-[var(--text)]">
          VoiceOut
        </h1>
        <p className="mt-2 max-w-sm text-[15px] leading-6 text-[var(--muted)]">
          The voice-first social app. Record, share, and listen. Built for real voices, not noise.
        </p>
        <div className="mt-6 flex w-full max-w-sm flex-col gap-2 sm:flex-row sm:justify-center">
          <Link
            href="/login"
            className="flex min-h-12 flex-1 items-center justify-center rounded-full bg-accent px-5 text-sm font-semibold text-white"
          >
            Log in
          </Link>
          <Link
            href="/register"
            className="flex min-h-12 flex-1 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--card)] px-5 text-sm font-semibold"
          >
            Create account
          </Link>
        </div>
      </section>

      <section className="mx-auto grid max-w-lg gap-3 px-4 pb-10">
        {promos.map((p) => (
          <article
            key={p.title}
            className="rounded-2xl border border-[var(--line)] bg-[var(--card)]/90 px-4 py-4 text-left shadow-sm"
          >
            <h2 className="text-sm font-bold text-[var(--text)]">{p.title}</h2>
            <p className="mt-1 text-sm leading-5 text-[var(--muted)]">{p.body}</p>
          </article>
        ))}
      </section>
    </div>
  );
}
