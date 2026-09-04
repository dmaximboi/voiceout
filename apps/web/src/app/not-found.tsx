import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-6 py-16 text-center">
      <p className="text-sm font-semibold tracking-wide text-[var(--muted)]">404</p>
      <h1 className="mt-2 text-2xl font-bold text-[var(--text)]">Page not found</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        That link does not exist, or you do not have access to it.
      </p>
      <Link
        href="/"
        className="mt-6 inline-flex min-h-11 items-center justify-center rounded-full bg-accent px-5 text-sm font-semibold text-white"
      >
        Back home
      </Link>
    </main>
  );
}
