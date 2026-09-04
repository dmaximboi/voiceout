export function FeedSkeleton() {
  return (
    <div className="border-b border-[var(--line)] px-4 py-4">
      <div className="flex animate-pulse gap-3">
        <div className="h-9 w-9 shrink-0 rounded-full bg-[var(--line)]" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="h-3 w-40 rounded bg-[var(--line)]" />
          <div className="h-3 w-full rounded bg-[var(--line)]" />
          <div className="h-3 w-2/3 rounded bg-[var(--line)]" />
          {/* Match post image footprint (object-contain area), not a thin bar that crops feel */}
          <div className="mt-3 aspect-[4/3] w-full max-h-80 rounded-xl bg-[var(--line)]" />
          <div className="mt-3 h-12 w-full rounded-2xl bg-[var(--line)]" />
          <div className="flex gap-4 pt-2">
            <div className="h-3 w-10 rounded bg-[var(--line)]" />
            <div className="h-3 w-10 rounded bg-[var(--line)]" />
            <div className="h-3 w-10 rounded bg-[var(--line)]" />
            <div className="h-3 w-10 rounded bg-[var(--line)]" />
          </div>
        </div>
      </div>
    </div>
  );
}
