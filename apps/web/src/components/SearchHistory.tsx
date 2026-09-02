'use client';

import { useEffect, useState } from 'react';
import type { SearchHistoryItem } from '@voiceout/shared';
import { Clock3 } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export function SearchHistory({ onSelect }: { onSelect: (query: string) => void }) {
  const { user, loading } = useAuth();
  const [history, setHistory] = useState<SearchHistoryItem[]>([]);

  useEffect(() => {
    if (loading || !user) {
      setHistory([]);
      return;
    }
    let cancelled = false;
    void api<{ history: SearchHistoryItem[] }>('/search/history?limit=20')
      .then((data) => {
        if (!cancelled) setHistory(uniqueQueries(data.history));
      })
      .catch(() => {
        if (!cancelled) setHistory([]);
      });
    return () => {
      cancelled = true;
    };
  }, [loading, user]);

  async function clear() {
    const previous = history;
    setHistory([]);
    try {
      await api('/search/history', { method: 'DELETE' });
    } catch {
      setHistory(previous);
    }
  }

  if (history.length === 0) {
    return <p className="px-4 py-6 text-sm text-[var(--muted)]">Find people by name or handle.</p>;
  }

  return (
    <section aria-labelledby="recent-searches-heading">
      <div className="flex min-h-12 items-center justify-between gap-3 border-b border-[var(--line)] px-4">
        <h2 id="recent-searches-heading" className="text-sm font-semibold">
          Recent searches
        </h2>
        <button
          type="button"
          className="min-h-10 text-sm font-semibold text-accent"
          onClick={() => void clear()}
        >
          Clear all
        </button>
      </div>
      <ul>
        {history.map((item) => (
          <li key={item.id} className="border-b border-[var(--line)]">
            <button
              type="button"
              className="flex min-h-12 w-full items-center gap-3 px-4 text-left active:bg-[var(--bg)]"
              onClick={() => onSelect(item.query)}
            >
              <Clock3 size={17} className="shrink-0 text-[var(--muted)]" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-sm">{item.query}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function uniqueQueries(history: SearchHistoryItem[]): SearchHistoryItem[] {
  const seen = new Set<string>();
  return history.filter((item) => {
    const key = `${item.scope}:${item.query.toLocaleLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
