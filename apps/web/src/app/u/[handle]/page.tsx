'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { PostCard, PublicUser } from '@voiceout/shared';
import { MoreHorizontal } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Avatar } from '@/components/AppShell';
import { FeedCard } from '@/components/FeedCard';
import { ReportDialog } from '@/components/ReportDialog';

export default function ProfilePage() {
  const { handle } = useParams<{ handle: string }>();
  const { user, logout } = useAuth();
  const router = useRouter();
  const [profile, setProfile] = useState<PublicUser | null>(null);
  const [missing, setMissing] = useState(false);
  const [following, setFollowing] = useState(false);
  const [notifyPosts, setNotifyPosts] = useState(false);
  const [posts, setPosts] = useState<PostCard[]>([]);
  const [reportOpen, setReportOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setMissing(false);
    void api<{ user: PublicUser; following: boolean; notifyPosts?: boolean }>(`/users/${handle}`)
      .then((d) => {
        if (cancelled) return;
        setProfile(d.user);
        setFollowing(d.following);
        setNotifyPosts(Boolean(d.notifyPosts));
      })
      .catch(() => {
        if (cancelled) return;
        setProfile(null);
        setMissing(true);
      });
    void api<{ posts: PostCard[] }>(`/users/${handle}/posts`)
      .then((d) => {
        if (!cancelled) setPosts(d.posts);
      })
      .catch(() => {
        if (!cancelled) setPosts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [handle, user?.id]);

  useEffect(() => {
    if (!menuOpen) return;
    function onDoc(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [menuOpen]);

  if (missing) return <p className="p-6 text-sm text-[var(--muted)]">Profile not found.</p>;
  if (!profile) return <p className="p-6 text-sm text-[var(--muted)]">Loading profile.</p>;

  const person = profile;
  const mine = user?.id === person.id;

  async function toggleFollow() {
    if (!user) {
      router.push(`/login?next=/u/${person.handle}`);
      return;
    }
    if (following) {
      await api(`/users/${person.id}/follow`, { method: 'DELETE' });
      setFollowing(false);
      setNotifyPosts(false);
    } else {
      const res = await api<{ notifyPosts?: boolean }>(`/users/${person.id}/follow`, {
        method: 'POST',
        body: '{}',
      });
      setFollowing(true);
      setNotifyPosts(Boolean(res.notifyPosts));
    }
  }

  async function toggleNotify() {
    if (!user || !following) return;
    const next = !notifyPosts;
    const res = await api<{ notifyPosts: boolean }>(`/users/${person.id}/follow`, {
      method: 'PATCH',
      body: JSON.stringify({ notifyPosts: next }),
    });
    setNotifyPosts(res.notifyPosts);
  }

  async function block() {
    if (!user) return;
    setMenuOpen(false);
    await api(`/users/${person.id}/block`, { method: 'POST', body: '{}' });
    router.push('/');
  }

  return (
    <div>
      <div className="border-b border-[var(--line)] px-4 py-6">
        <div className="flex items-start justify-between gap-3">
          <Avatar name={profile.displayName} src={profile.avatarUrl} size="lg" />
          {!mine ? (
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                aria-label="Account options"
                className="grid h-10 w-10 place-items-center rounded-full border border-[var(--line)]"
                onClick={() => setMenuOpen((v) => !v)}
              >
                <MoreHorizontal size={20} />
              </button>
              {menuOpen ? (
                <div className="absolute right-0 z-20 mt-2 w-44 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--card)] shadow-lg">
                  <button
                    type="button"
                    className="flex min-h-11 w-full items-center px-4 text-left text-sm"
                    onClick={() => void block()}
                  >
                    Block
                  </button>
                  <button
                    type="button"
                    className="flex min-h-11 w-full items-center px-4 text-left text-sm text-red-600"
                    onClick={() => {
                      setMenuOpen(false);
                      setReportOpen(true);
                    }}
                  >
                    Report
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        <h1 className="mt-3 text-xl font-bold">{profile.displayName}</h1>
        <p className="text-[var(--muted)]">@{profile.handle}</p>
        {profile.bio ? <p className="mt-2 text-sm">{profile.bio}</p> : null}
        <p className="mt-3 text-sm">
          <span className="font-semibold">{profile.followingCount}</span> Following ·{' '}
          <span className="font-semibold">{profile.followerCount}</span> Followers
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {mine ? (
            <>
              <button
                type="button"
                onClick={() => router.push('/settings')}
                className="flex min-h-11 items-center rounded-full border border-[var(--line)] px-4 text-sm active:bg-[var(--bg)]"
              >
                Edit profile
              </button>
              <button
                type="button"
                onClick={() => void logout().then(() => router.push('/login'))}
                className="flex min-h-11 items-center rounded-full border border-[var(--line)] px-4 text-sm text-red-600 active:bg-[var(--bg)]"
              >
                Log out
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => void toggleFollow()}
                className="flex min-h-11 items-center rounded-full bg-accent px-4 text-sm font-semibold text-white active:opacity-80"
              >
                {following ? 'Following' : 'Follow'}
              </button>
              {following ? (
                <button
                  type="button"
                  onClick={() => void toggleNotify()}
                  className={`flex min-h-11 items-center rounded-full border px-4 text-sm ${
                    notifyPosts ? 'border-accent text-accent' : 'border-[var(--line)]'
                  }`}
                >
                  {notifyPosts ? 'Keeping notified' : 'Keep notified'}
                </button>
              ) : null}
            </>
          )}
        </div>
      </div>
      {user ? (
        posts.map((p) => (
          <FeedCard
            key={p.id}
            post={p}
            onChange={(next) => setPosts((all) => all.map((x) => (x.id === next.id ? next : x)))}
          />
        ))
      ) : (
        <p className="p-4 text-sm text-[var(--muted)]">Log in to see posts.</p>
      )}
      {reportOpen ? (
        <ReportDialog
          targetType="user"
          targetId={person.id}
          targetLabel="account"
          onClose={() => setReportOpen(false)}
        />
      ) : null}
    </div>
  );
}
