import type { ReactNode } from 'react';
import Link from 'next/link';

export function LegalArticle({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <article className="mx-auto max-w-2xl px-4 py-8">
      <p className="text-sm text-[var(--muted)]">
        <Link href="/" className="text-accent">
          Home
        </Link>
      </p>
      <h1 className="mt-4 text-2xl font-bold">{title}</h1>
      <p className="mt-1 text-sm text-[var(--muted)]">Last updated {updated}</p>
      <div className="legal-prose mt-6 space-y-4 text-[15px] leading-7 [&_h2]:pt-4 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:pt-2 [&_h3]:text-base [&_h3]:font-semibold [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:space-y-1.5 [&_ol]:pl-5 [&_a]:text-accent">
        {children}
      </div>
    </article>
  );
}
