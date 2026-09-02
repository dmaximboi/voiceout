'use client';

import { useState } from 'react';
import { Search } from 'lucide-react';
import { PeopleSearch } from '@/components/PeopleSearch';
import { SearchHistory } from '@/components/SearchHistory';

export default function SearchPage() {
  const [q, setQ] = useState('');

  return (
    <div>
      <div className="border-b border-[var(--line)] p-3">
        <label className="flex min-h-11 items-center gap-2 rounded-full bg-[var(--bg)] px-4">
          <Search size={18} strokeWidth={2} />
          <input
            className="w-full bg-transparent outline-none"
            placeholder="Search people"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
      </div>
      {q.trim() ? <PeopleSearch query={q} /> : <SearchHistory onSelect={setQ} />}
    </div>
  );
}
