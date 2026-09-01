'use client';

import { useEffect } from 'react';

export default function GlobalError({
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
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', padding: 24 }}>
        <h1 style={{ fontSize: 18, fontWeight: 600 }}>VoiceOut hit an error</h1>
        <p style={{ marginTop: 8, color: '#5a7190' }}>{error.message || 'Reload and try again.'}</p>
        <button
          type="button"
          onClick={() => reset()}
          style={{
            marginTop: 16,
            minHeight: 44,
            borderRadius: 999,
            background: '#2b8cff',
            color: '#fff',
            border: 0,
            padding: '0 20px',
            fontWeight: 600,
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
