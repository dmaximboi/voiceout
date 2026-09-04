'use client';

import Link from 'next/link';
import { Logo } from '@/components/Logo';
import { FeedList } from '@/components/FeedList';
import { SAMPLE_POSTS } from '@/lib/samplePosts';

export function GuestHome() {
  return (
    <div className="relative overflow-hidden pb-10">
      <div
        className="pointer-events-none absolute inset-0 -z-10 opacity-90"
        style={{
          background:
            'radial-gradient(ellipse 80% 50% at 50% -10%, color-mix(in oklab, var(--accent) 22%, transparent), transparent 70%), linear-gradient(180deg, var(--bg), var(--card))',
        }}
      />
      <section className="mx-auto flex max-w-lg flex-col items-center px-5 pb-6 pt-10 text-center">
        <Logo size={64} />
        <h1 className="mt-5 text-3xl font-bold tracking-tight text-[var(--text)]">VoiceOut</h1>
        <p className="mt-2 max-w-sm text-[15px] leading-6 text-[var(--muted)]">
          Voice-first social. Hear a drop, see the clip, feel the moment.
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

      <section className="mx-auto max-w-lg px-2">
        <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
          Sample drops
        </p>
        <FeedList posts={SAMPLE_POSTS} onChange={() => undefined} autoPlay={false} />
        <p className="mt-3 px-3 text-center text-xs text-[var(--muted)]">
          Demo audio, short video, and photos. You can swap these clips later.
        </p>
      </section>
    </div>
  );
}
