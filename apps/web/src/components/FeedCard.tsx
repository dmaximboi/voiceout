'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import type { PostCard } from '@voiceout/shared';
import { Bookmark, Heart, MessageCircle, Mic, Repeat2, Share2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { postPath, postShareUrl } from '@/lib/share';
import { Avatar } from './AppShell';
import { WaveformPlayer } from './WaveformPlayer';

const iconStroke = 2.75;

export function FeedCard({ post, onChange }: { post: PostCard; onChange?: (p: PostCard) => void }) {
  const { user } = useAuth();
  const router = useRouter();
  const path = usePathname();
  const demo = post.id.startsWith('sample-');
  const loved = post.myReaction === 'love';
  const loves = Object.values(post.reactionCounts).reduce((a, b) => a + b, 0);
  const [shared, setShared] = useState(false);
  const [repostOpen, setRepostOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [voiceText, setVoiceText] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!repostOpen) return;
    function onPointer(e: PointerEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setRepostOpen(false);
    }
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [repostOpen]);

  function needLogin() {
    router.push(`/login?next=${encodeURIComponent(path)}`);
  }

  async function runAction(label: string, work: () => Promise<void>) {
    setActionError(null);
    try {
      await work();
    } catch (err) {
      console.error(err);
      setActionError(err instanceof Error ? err.message : `Could not ${label}`);
      throw err;
    }
  }

  async function toggleLove() {
    if (!user) return needLogin();
    if (demo) {
      onChange?.({
        ...post,
        myReaction: loved ? null : 'love',
        reactionCounts: { ...post.reactionCounts, love: Math.max(0, post.reactionCounts.love + (loved ? -1 : 1)) },
      });
      return;
    }
    if (loved) {
      try {
        await runAction('remove love', () => api(`/posts/${post.id}/reactions`, { method: 'DELETE' }));
      } catch {
        return;
      }
      onChange?.({ ...post, myReaction: null, reactionCounts: { ...post.reactionCounts, love: Math.max(0, post.reactionCounts.love - 1) } });
    } else {
      try {
        await runAction('love', () => api(`/posts/${post.id}/reactions`, { method: 'PUT', body: JSON.stringify({ type: 'love' }) }));
      } catch {
        return;
      }
      const next = { ...post, myReaction: 'love' as const, reactionCounts: { ...post.reactionCounts } };
      if (post.myReaction) next.reactionCounts[post.myReaction] = Math.max(0, next.reactionCounts[post.myReaction] - 1);
      next.reactionCounts.love += 1;
      onChange?.(next);
    }
  }

  async function toggleBookmark() {
    if (!user) return needLogin();
    if (demo) {
      onChange?.({
        ...post,
        bookmarkedByMe: !post.bookmarkedByMe,
        bookmarkCount: post.bookmarkCount + (post.bookmarkedByMe ? -1 : 1),
      });
      return;
    }
    if (post.bookmarkedByMe) {
      try {
        await runAction('remove bookmark', () => api(`/posts/${post.id}/bookmark`, { method: 'DELETE' }));
      } catch {
        return;
      }
      onChange?.({ ...post, bookmarkedByMe: false, bookmarkCount: Math.max(0, post.bookmarkCount - 1) });
    } else {
      try {
        await runAction('bookmark', () => api(`/posts/${post.id}/bookmark`, { method: 'POST', body: '{}' }));
      } catch {
        return;
      }
      onChange?.({ ...post, bookmarkedByMe: true, bookmarkCount: post.bookmarkCount + 1 });
    }
  }

  async function toggleRepost() {
    if (!user) return needLogin();
    setRepostOpen(false);
    if (demo) {
      onChange?.({
        ...post,
        repostedByMe: !post.repostedByMe,
        repostCount: post.repostCount + (post.repostedByMe ? -1 : 1),
      });
      return;
    }
    if (post.repostedByMe) {
      try {
        await runAction('remove repost', () => api(`/posts/${post.id}/repost`, { method: 'DELETE' }));
      } catch {
        return;
      }
      onChange?.({ ...post, repostedByMe: false, repostCount: Math.max(0, post.repostCount - 1) });
    } else {
      try {
        await runAction('repost', () => api(`/posts/${post.id}/repost`, { method: 'POST', body: '{}' }));
      } catch {
        return;
      }
      onChange?.({ ...post, repostedByMe: true, repostCount: post.repostCount + 1 });
    }
  }

  async function submitVoice() {
    if (!user) return needLogin();
    const body = voiceText.trim();
    if (!body) return;
    if (!demo) {
      try {
        await runAction('voice', () => api(`/posts/${post.id}/voice`, { method: 'POST', body: JSON.stringify({ body }) }));
      } catch {
        return;
      }
    }
    onChange?.({
      ...post,
      voicedByMe: true,
      voiceCount: post.voicedByMe ? post.voiceCount : post.voiceCount + 1,
    });
    setVoiceText('');
    setVoiceOpen(false);
  }

  async function share() {
    if (demo) return;
    const url = postShareUrl(post.id, { via: user?.id });
    try {
      if (navigator.share) {
        await navigator.share({
          title: `${post.author.displayName} on VoiceOut`,
          text: post.caption || `${post.author.displayName} dropped a voice on VoiceOut.`,
          url,
        });
      } else {
        await navigator.clipboard.writeText(url);
      }
      setShared(true);
      window.setTimeout(() => setShared(false), 1600);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      console.error(err);
      setActionError(err instanceof Error ? err.message : 'Could not share');
    }
  }

  const btn =
    'inline-flex min-h-11 min-w-[2.75rem] flex-1 items-center justify-center gap-1 rounded-lg px-1 text-xs sm:text-sm active:bg-[var(--bg)]';
  const spread = post.repostCount + post.voiceCount;

  return (
    <article className="border-b border-[var(--line)] px-3 py-4 sm:px-4">
      {actionError ? <p className="mb-2 text-sm text-red-600">{actionError}</p> : null}
      <div className="flex gap-3">
        {demo ? (
          <Avatar name={post.author.displayName} src={post.author.avatarUrl} />
        ) : (
          <Link href={`/u/${post.author.handle}`} className="shrink-0 active:opacity-80">
            <Avatar name={post.author.displayName} src={post.author.avatarUrl} />
          </Link>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0">
            {demo ? (
              <span className="max-w-full truncate font-semibold">{post.author.displayName}</span>
            ) : (
              <Link href={`/u/${post.author.handle}`} className="max-w-full truncate font-semibold active:opacity-80">
                {post.author.displayName}
              </Link>
            )}
            <span className="max-w-[40%] truncate text-sm text-[var(--muted)]">@{post.author.handle}</span>
            <span className="shrink-0 text-xs text-[var(--muted)]">{timeAgo(post.createdAt)}</span>
          </div>
          {demo ? (
            <p className="mt-1 break-words whitespace-pre-wrap text-[15px] leading-6">{post.caption}</p>
          ) : (
            <Link href={postPath(post.id)} className="mt-1 block break-words whitespace-pre-wrap text-[15px] leading-6 active:opacity-80">
              {post.caption}
            </Link>
          )}
          {post.videoUrl ? (
            <video
              className="mt-3 w-full rounded-xl bg-black"
              src={post.videoUrl}
              poster={post.imageUrls[0]}
              muted
              loop
              playsInline
              autoPlay
              preload="metadata"
            />
          ) : post.imageUrls.length > 0 ? (
            <div className={`mt-3 overflow-hidden rounded-xl ${post.imageUrls.length > 1 ? 'grid grid-cols-2 gap-1' : ''}`}>
              {post.imageUrls.map((src) => (
                <img key={src} src={src} alt="" className="max-h-80 w-full object-cover" />
              ))}
            </div>
          ) : null}
          <div className="mt-3 min-w-0">
            <WaveformPlayer trackId={post.id} src={post.audioUrl} durationMs={post.durationMs} />
          </div>
          <div className="mt-1 -mx-1 flex items-center justify-between text-[var(--muted)]">
            <button type="button" aria-label="Love" onClick={() => void toggleLove()} className={`${btn} ${loved ? 'text-accent' : ''}`}>
              <Heart size={20} strokeWidth={iconStroke} fill={loved ? 'currentColor' : 'none'} />
              {loves}
            </button>
            {demo ? (
              <span className={btn}>
                <MessageCircle size={20} strokeWidth={iconStroke} />
                {post.commentCount}
              </span>
            ) : (
              <Link href={postPath(post.id)} className={btn}>
                <MessageCircle size={20} strokeWidth={iconStroke} />
                {post.commentCount}
              </Link>
            )}
            <div className="relative flex-1" ref={menuRef}>
              <button
                type="button"
                aria-label="Repost or voice"
                aria-expanded={repostOpen}
                onClick={() => {
                  if (!user) return needLogin();
                  setRepostOpen((v) => !v);
                }}
                className={`${btn} w-full ${post.repostedByMe || post.voicedByMe ? 'text-accent' : ''}`}
              >
                <Repeat2 size={20} strokeWidth={iconStroke} />
                {spread}
              </button>
              {repostOpen ? (
                <div className="absolute bottom-12 left-1/2 z-20 w-44 -translate-x-1/2 overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--card)] py-1 shadow-lg">
                  <button
                    type="button"
                    className="flex min-h-11 w-full items-center gap-2 px-3 text-left text-sm font-medium active:bg-[var(--bg)]"
                    onClick={() => void toggleRepost()}
                  >
                    <Repeat2 size={18} strokeWidth={iconStroke} />
                    {post.repostedByMe ? 'Undo repost' : 'Repost'}
                  </button>
                  <button
                    type="button"
                    className="flex min-h-11 w-full items-center gap-2 px-3 text-left text-sm font-medium active:bg-[var(--bg)]"
                    onClick={() => {
                      setRepostOpen(false);
                      setVoiceOpen(true);
                    }}
                  >
                    <Mic size={18} strokeWidth={iconStroke} />
                    Voice
                  </button>
                </div>
              ) : null}
            </div>
            <button type="button" aria-label="Share" onClick={() => void share()} className={btn}>
              <Share2 size={20} strokeWidth={iconStroke} />
              <span className="hidden sm:inline">{shared ? 'Copied' : 'Share'}</span>
            </button>
            <button
              type="button"
              aria-label="Bookmark"
              onClick={() => void toggleBookmark()}
              className={`${btn} ${post.bookmarkedByMe ? 'text-accent' : ''}`}
            >
              <Bookmark size={20} strokeWidth={iconStroke} fill={post.bookmarkedByMe ? 'currentColor' : 'none'} />
            </button>
          </div>
          {voiceOpen ? (
            <div className="mt-2 rounded-2xl border border-[var(--line)] bg-[var(--bg)] p-3">
              <p className="mb-2 text-xs font-semibold text-[var(--muted)]">Voice</p>
              <textarea
                className="w-full min-h-16 rounded-xl border border-[var(--line)] bg-[var(--card)] p-2 text-base"
                maxLength={500}
                value={voiceText}
                onChange={(e) => setVoiceText(e.target.value)}
                placeholder="Voice"
              />
              <div className="mt-2 flex justify-end gap-2">
                <button type="button" className="min-h-10 rounded-full px-3 text-sm" onClick={() => setVoiceOpen(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="min-h-10 rounded-full bg-accent px-4 text-sm font-semibold text-white disabled:opacity-50"
                  disabled={!voiceText.trim()}
                  onClick={() => void submitVoice()}
                >
                  Voice
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function timeAgo(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return `${Math.floor(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
