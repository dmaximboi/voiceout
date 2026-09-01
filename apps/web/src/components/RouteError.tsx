'use client';

import { useEffect } from 'react';

export function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="px-4 py-10">
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        {error.message || 'This screen hit an error. You can try again.'}
      </p>
      <button
        type="button"
        className="mt-4 flex min-h-11 items-center rounded-full bg-accent px-5 text-sm font-semibold text-white active:opacity-80"
        onClick={() => reset()}
      >
        Try again
      </button>
    </div>
  );
}

export default RouteError;
