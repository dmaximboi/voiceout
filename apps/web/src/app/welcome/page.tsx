'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import type { MeUser, PublicUser } from '@voiceout/shared';
import { COUNTRIES } from '@voiceout/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { safeNextPath } from '@/lib/paths';
import { Avatar } from '@/components/Avatar';
import { Logo } from '@/components/Logo';

type SuggestUser = PublicUser;

function markWelcomeSeen() {
  try {
    sessionStorage.setItem('vo_welcome_seen', '1');
    sessionStorage.removeItem('vo_need_welcome');
  } catch {
    /* private mode */
  }
  try {
    localStorage.setItem('vo_welcome_seen', '1');
  } catch {
    /* private mode */
  }
}

export default function WelcomePage() {
  return (
    <Suspense>
      <WelcomeInner />
    </Suspense>
  );
}

function WelcomeInner() {
  const { user, loading, applyUser } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNextPath(params.get('next'));
  const [city, setCity] = useState('');
  const [country, setCountry] = useState('');
  const [people, setPeople] = useState<SuggestUser[]>([]);
  const [following, setFollowing] = useState<Set<string>>(new Set());
  const [placeBusy, setPlaceBusy] = useState(false);
  const [placeNote, setPlaceNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) router.replace(`/login?next=/welcome`);
  }, [loading, user, router]);

  useEffect(() => {
    if (!user) return;
    setCity(user.city ?? '');
    setCountry(user.country ?? '');
  }, [user]);

  useEffect(() => {
    if (!user) return;
    void api<{ users: SuggestUser[] }>('/users/suggestions?limit=12')
      .then((data) => setPeople(data.users))
      .catch(() => setPeople([]));
  }, [user?.id, user?.city, user?.country]);

  async function savePlace() {
    if (!city.trim() && !country) return;
    setError(null);
    setPlaceBusy(true);
    try {
      const data = await api<{ user: MeUser }>('/users/me', {
        method: 'PATCH',
        body: JSON.stringify({ city: city.trim(), country }),
      });
      applyUser(data.user);
      setPlaceNote('Saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save city');
    } finally {
      setPlaceBusy(false);
    }
  }

  async function useLocation() {
    setError(null);
    setPlaceBusy(true);
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000, maximumAge: 60_000 });
      });
      const data = await api<{ user: MeUser }>('/users/me/place', {
        method: 'POST',
        body: JSON.stringify({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      });
      applyUser(data.user);
      setCity(data.user.city ?? '');
      setCountry(data.user.country ?? '');
      setPlaceNote('Saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read location. Type your city instead.');
    } finally {
      setPlaceBusy(false);
    }
  }

  async function toggleFollow(person: SuggestUser) {
    const nextFollowing = new Set(following);
    try {
      if (nextFollowing.has(person.id)) {
        await api(`/users/${person.id}/follow`, { method: 'DELETE' });
        nextFollowing.delete(person.id);
      } else {
        await api(`/users/${person.id}/follow`, { method: 'POST', body: '{}' });
        nextFollowing.add(person.id);
      }
      setFollowing(nextFollowing);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not follow');
    }
  }

  function finish() {
    markWelcomeSeen();
    router.replace(next);
  }

  if (loading || !user) {
    return <p className="px-4 py-10 text-center text-sm text-[var(--muted)]">Checking your session.</p>;
  }

  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <div className="flex justify-center">
        <Logo size={64} />
      </div>
      <h1 className="mt-3 text-center text-2xl font-bold">People to follow</h1>
      <p className="mt-2 text-center text-sm text-[var(--muted)]">
        Share your city if you want voices near you. You can skip this.
      </p>

      <div className="mt-6 space-y-3 rounded-2xl border border-[var(--line)] p-4">
        <label className="block text-sm font-medium">
          City
          <input
            className="mt-1 w-full min-h-11 rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3 text-base font-normal"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            maxLength={80}
            placeholder="Lagos"
          />
        </label>
        <label className="block text-sm font-medium">
          Country
          <select
            className="mt-1 w-full min-h-11 rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3 text-base font-normal"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
          >
            <option value="">Select</option>
            {COUNTRIES.map((row) => (
              <option key={row.code} value={row.code}>
                {row.name}
              </option>
            ))}
          </select>
        </label>
        {placeNote ? <p className="text-sm text-accent">{placeNote}</p> : null}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="flex min-h-11 items-center rounded-full bg-accent px-4 text-sm font-semibold text-white disabled:opacity-60"
            disabled={placeBusy}
            onClick={() => void savePlace()}
          >
            {placeBusy ? 'Saving…' : 'Save city'}
          </button>
          <button
            type="button"
            className="flex min-h-11 items-center rounded-full border border-[var(--line)] px-4 text-sm font-semibold disabled:opacity-60"
            disabled={placeBusy}
            onClick={() => void useLocation()}
          >
            Use my location
          </button>
        </div>
      </div>

      <ul className="mt-6 space-y-3">
        {people.map((person) => (
          <li key={person.id} className="flex items-center gap-3">
            <Link href={`/u/${person.handle}`} className="flex min-w-0 flex-1 items-center gap-3">
              <Avatar name={person.displayName} src={person.avatarUrl} />
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{person.displayName}</div>
                <div className="truncate text-xs text-[var(--muted)]">@{person.handle}</div>
              </div>
            </Link>
            <button
              type="button"
              className={`min-h-10 shrink-0 rounded-full px-4 text-sm font-semibold ${
                following.has(person.id) ? 'border border-[var(--line)]' : 'bg-accent text-white'
              }`}
              onClick={() => void toggleFollow(person)}
            >
              {following.has(person.id) ? 'Following' : 'Follow'}
            </button>
          </li>
        ))}
      </ul>
      {people.length === 0 ? (
        <p className="mt-6 text-center text-sm text-[var(--muted)]">No suggestions yet. You can continue.</p>
      ) : null}
      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
      <button
        type="button"
        className="mt-8 flex min-h-11 w-full items-center justify-center rounded-full bg-accent font-semibold text-white"
        onClick={finish}
      >
        Continue
      </button>
      <button type="button" className="mt-3 flex min-h-11 w-full items-center justify-center text-sm font-semibold text-[var(--muted)]" onClick={finish}>
        Skip
      </button>
    </div>
  );
}
