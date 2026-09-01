'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { PostCard, PublicUser } from '@voiceout/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Avatar } from '@/components/AppShell';
import { FeedCard } from '@/components/FeedCard';

export default function ProfilePage() {
  const { handle } = useParams<{ handle: string }>();
  const { user, logout } = useAuth();
  const router = useRouter();
  const [profile, setProfile] = useState<PublicUser | null>(null);
  const [following, setFollowing] = useState(false);
  const [posts, setPosts] = useState<PostCard[]>([]);

  useEffect(() => {
    void api<{ user: PublicUser; following: boolean }>(`/users/${handle}`)
      .then((d) => {
        setProfile(d.user);
        setFollowing(d.following);
      })
      .catch(() => setProfile(null));
    void api<{ posts: PostCard[] }>(`/users/${handle}/posts`)
      .then((d) => setPosts(d.posts))
      .catch(() => setPosts([]));
  }, [handle, user]);

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
    } else {
      await api(`/users/${person.id}/follow`, { method: 'POST', body: '{}' });
      setFollowing(true);
    }
  }

  async function block() {
    if (!user) return;
    await api(`/users/${person.id}/block`, { method: 'POST', body: '{}' });
    router.push('/');
  }

  return (
    <div>
      <div className="border-b border-[var(--line)] px-4 py-6">
        <Avatar name={profile.displayName} src={profile.avatarUrl} size="lg" />
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
              <button type="button" onClick={() => router.push('/settings')} className="flex min-h-11 items-center rounded-full border border-[var(--line)] px-4 text-sm active:bg-[var(--bg)]">
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
              <button type="button" onClick={() => void toggleFollow()} className="flex min-h-11 items-center rounded-full bg-accent px-4 text-sm font-semibold text-white active:opacity-80">
                {following ? 'Following' : 'Follow'}
              </button>
              <button type="button" onClick={() => void block()} className="flex min-h-11 items-center rounded-full border border-[var(--line)] px-4 text-sm active:bg-[var(--bg)]">
                Block
              </button>
            </>
          )}
        </div>
      </div>
      {user ? (
        posts.map((p) => (
          <FeedCard key={p.id} post={p} onChange={(next) => setPosts((all) => all.map((x) => (x.id === next.id ? next : x)))} />
        ))
      ) : (
        <p className="p-4 text-sm text-[var(--muted)]">Log in to see posts.</p>
      )}
    </div>
  );
}
