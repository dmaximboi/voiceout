import Link from 'next/link';

export function LegalLinks({ className = '' }: { className?: string }) {
  return (
    <p className={`text-center text-xs text-[var(--muted)] ${className}`}>
      <Link href="/privacy" className="underline-offset-2 hover:underline">
        Privacy
      </Link>
      {' · '}
      <Link href="/terms" className="underline-offset-2 hover:underline">
        Terms
      </Link>
    </p>
  );
}
