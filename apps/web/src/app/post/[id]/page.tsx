'use client';

import {
  COMMENT_CATEGORIES,
  PRESET_STICKERS,
  canVoiceComment,
  maxCommentLength,
  maxVoiceCommentSeconds,
  type CommentCard,
  type CommentCategory,
  type PostCard,
} from '@voiceout/shared';
import { Heart, Loader2, Mic, Reply, Smile, Square, X } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, Suspense } from 'react';
import { api, ApiError, uploadAudio } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { startOpusRecording, warmupOpus, type OpusHandle } from '@/lib/recordOpus';
import { FeedCard } from '@/components/FeedCard';
import { WaveformPlayer } from '@/components/WaveformPlayer';
import { Avatar } from '@/components/AppShell';
import { ReportDialog } from '@/components/ReportDialog';

export default function PostPage() {
  return (
    <Suspense fallback={<p className="p-4 text-sm text-[var(--muted)]">Opening voice.</p>}>
      <PostPageInner />
    </Suspense>
  );
}

function PostPageInner() {
  const { id } = useParams<{ id: string }>();
  const { user, loading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const via = searchParams.get('via');
  const [post, setPost] = useState<PostCard | null>(null);
  const [comments, setComments] = useState<CommentCard[]>([]);
  const [body, setBody] = useState('');
  const [stickersOpen, setStickersOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [micBusy, setMicBusy] = useState(false);
  const [replyBusy, setReplyBusy] = useState(false);
  const [voiceBlob, setVoiceBlob] = useState<Blob | null>(null);
  const [missing, setMissing] = useState(false);
  const [fatal, setFatal] = useState<Error | null>(null);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [commentCategory, setCommentCategory] = useState<'all' | CommentCategory>('all');
  const [replyToCommentId, setReplyToCommentId] = useState<string | null>(null);
  const [reportComment, setReportComment] = useState<CommentCard | null>(null);
  const recRef = useRef<OpusHandle | null>(null);
  const micLock = useRef(false);
  const textRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void warmupOpus();
  }, []);

  async function load() {
    try {
      const p = await api<{ post: PostCard }>(`/posts/${id}`);
      setPost(p.post);
      const c = await api<{ comments: CommentCard[] }>(`/posts/${id}/comments`);
      setComments(c.comments);
      setMissing(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setPost(null);
        setComments([]);
        setMissing(true);
        return;
      }
      setFatal(err instanceof Error ? err : new Error('Could not load this voice'));
    }
  }

  useEffect(() => {
    if (loading) return;
    void load();
  }, [id, loading, user?.id]);

  useEffect(() => {
    if (loading || !user || !via || !id) return;
    if (!/^[0-9a-f-]{36}$/i.test(via) || via === user.id) return;
    void api(`/posts/${id}/share-open`, { method: 'POST', body: JSON.stringify({ via }) }).catch(
      () => undefined,
    );
  }, [id, loading, user, via]);

  function insertEmoji(emoji: string) {
    const el = textRef.current;
    const start = el?.selectionStart ?? body.length;
    const end = el?.selectionEnd ?? body.length;
    const next = body.slice(0, start) + emoji + body.slice(end);
    setBody(next);
    setStickersOpen(false);
    window.setTimeout(() => {
      el?.focus();
      const pos = start + emoji.length;
      el?.setSelectionRange(pos, pos);
    }, 0);
  }

  async function toggleMic() {
    if (micLock.current || replyBusy) return;
    if (recording) {
      micLock.current = true;
      setMicBusy(true);
      recRef.current?.stop();
      return;
    }
    if (!canVoiceComment(user?.planTier)) {
      setReplyError('Subscribe to send voice replies');
      router.push('/settings');
      return;
    }
    const voiceSeconds = maxVoiceCommentSeconds(user?.planTier);
    micLock.current = true;
    setMicBusy(true);
    setReplyError(null);
    try {
      recRef.current = await startOpusRecording({
        onStop: (file) => {
          setVoiceBlob(file);
          setRecording(false);
          recRef.current = null;
          micLock.current = false;
          setMicBusy(false);
        },
      });
      setRecording(true);
      setVoiceBlob(null);
      setStickersOpen(false);
      setMicBusy(false);
      window.setTimeout(() => recRef.current?.stop(), voiceSeconds * 1000);
    } catch (err) {
      micLock.current = false;
      setMicBusy(false);
      console.error(err);
      setReplyError(err instanceof Error ? err.message : 'Could not use the mic');
    }
  }

  async function submit() {
    if (replyBusy || micBusy || recording) return;
    if (!user) {
      router.push(`/login?next=/post/${id}`);
      return;
    }
    if (!body.trim() && !voiceBlob) return;
    setReplyBusy(true);
    setReplyError(null);
    try {
      let mediaId: string | undefined;
      if (voiceBlob) {
        if (!canVoiceComment(user.planTier)) {
          setReplyError('Subscribe to send voice replies');
          router.push('/settings');
          return;
        }
        const voiceSeconds = maxVoiceCommentSeconds(user.planTier);
        mediaId = await uploadAudio('comment_audio', voiceBlob, voiceSeconds);
      }
      await api<{ comment: CommentCard }>(`/posts/${id}/comments`, {
        method: 'POST',
        body: JSON.stringify({
          body: body.trim().slice(0, maxCommentLength(user.planTier)),
          mediaId,
          replyToCommentId: replyToCommentId ?? undefined,
        }),
      });
      setBody('');
      setVoiceBlob(null);
      setReplyToCommentId(null);
      setCommentCategory('all');
      await load();
    } catch (err) {
      console.error(err);
      setReplyError(err instanceof Error ? err.message : 'Could not reply');
    } finally {
      setReplyBusy(false);
    }
  }

  if (fatal) throw fatal;
  if (loading) return <p className="p-6 text-sm text-[var(--muted)]">Loading.</p>;
  if (missing)
    return <p className="p-6 text-sm text-[var(--muted)]">This voice is gone or private.</p>;
  if (!post) return <p className="p-6 text-sm text-[var(--muted)]">Loading.</p>;

  const categoryCounts = countCommentCategories(comments);
  const shownCategories = COMMENT_CATEGORIES.filter(
    (category) => (categoryCounts.get(category) ?? 0) > 0,
  );
  const visibleComments =
    commentCategory === 'all'
      ? comments
      : comments.filter((comment) => comment.categories.includes(commentCategory));
  const commentsById = new Map(comments.map((comment) => [comment.id, comment]));
  const replyTarget = replyToCommentId ? commentsById.get(replyToCommentId) : undefined;
  const canVoiceReply = canVoiceComment(user?.planTier);
  const commentLimit = maxCommentLength(user?.planTier);

  return (
    <div>
      <FeedCard
        post={post}
        onChange={setPost}
        onRemove={() => router.push('/')}
      />
      {replyError ? <p className="px-4 pt-2 text-sm text-red-600">{replyError}</p> : null}
      <div className="border-b border-[var(--line)] px-3 py-3">
        {user ? (
          <div className="relative">
            {replyTarget ? (
              <div className="mb-2 flex items-center gap-2 rounded-xl bg-[var(--bg)] px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate text-[var(--muted)]">
                  Replying to{' '}
                  <strong className="text-[var(--text)]">{replyTarget.author.displayName}</strong>
                </span>
                <button
                  type="button"
                  aria-label="Cancel reply"
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-full active:bg-[var(--card)]"
                  onClick={() => setReplyToCommentId(null)}
                >
                  <X size={17} aria-hidden />
                </button>
              </div>
            ) : null}
            <div className="flex items-center gap-1 rounded-full border border-[var(--line)] bg-[var(--bg)] px-1">
              <button
                type="button"
                aria-label="Stickers"
                disabled={recording || micBusy || Boolean(voiceBlob)}
                onClick={() => setStickersOpen((v) => !v)}
                className="grid h-11 w-11 place-items-center rounded-full text-[var(--text)] active:bg-[var(--card)] disabled:opacity-40"
              >
                <Smile size={22} strokeWidth={2.75} />
              </button>
              <input
                ref={textRef}
                className="min-h-11 min-w-0 flex-1 bg-transparent text-base outline-none disabled:text-[var(--muted)]"
                placeholder={canVoiceReply ? 'Reply...' : 'Reply (text only)'}
                value={body}
                maxLength={commentLimit}
                disabled={recording || micBusy || Boolean(voiceBlob)}
                onChange={(e) => setBody(e.target.value.slice(0, commentLimit))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void submit();
                  }
                }}
              />
              <button
                type="button"
                aria-label={recording ? 'Stop' : 'Voice'}
                disabled={micBusy || replyBusy}
                onClick={() => void toggleMic()}
                className={`grid h-11 w-11 place-items-center rounded-full disabled:opacity-40 ${recording ? 'text-red-500' : 'text-[var(--text)]'} active:bg-[var(--card)]`}
              >
                {micBusy ? (
                  <Loader2 size={18} className="animate-spin" strokeWidth={2.75} />
                ) : recording ? (
                  <Square size={18} strokeWidth={2.75} />
                ) : (
                  <Mic size={22} strokeWidth={2.75} />
                )}
              </button>
            </div>
            {stickersOpen ? (
              <div className="absolute bottom-14 left-0 z-20 grid grid-cols-8 gap-1 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-2 shadow-lg">
                {PRESET_STICKERS.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className="grid h-10 w-10 place-items-center rounded-lg text-lg active:bg-[var(--bg)]"
                    onClick={() => insertEmoji(s.emoji)}
                  >
                    {s.emoji}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="mt-2 flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-[var(--muted)]">
                {recording ? (
                  'Recording...'
                ) : voiceBlob ? (
                  <button
                    type="button"
                    className="font-semibold"
                    onClick={() => setVoiceBlob(null)}
                  >
                    Voice ready · Undo
                  </button>
                ) : (
                  `${body.length}/${commentLimit}`
                )}
              </p>
              <button
                type="button"
                className="flex min-h-11 items-center gap-2 rounded-full bg-accent px-5 text-sm font-bold text-white disabled:opacity-40"
                disabled={replyBusy || micBusy || recording || (!body.trim() && !voiceBlob)}
                onClick={() => void submit()}
              >
                {replyBusy ? <Loader2 size={16} className="animate-spin" /> : null}
                {replyBusy ? 'Sending' : 'Reply'}
              </button>
            </div>
          </div>
        ) : (
          <p className="text-sm">
            <Link href={`/login?next=/post/${id}`} className="font-semibold text-accent">
              Log in
            </Link>{' '}
            to reply.
          </p>
        )}
      </div>
      <div
        role="tablist"
        aria-label="Comment categories"
        className="flex gap-1 overflow-x-auto border-b border-[var(--line)] px-3 py-2"
      >
        <button
          id="comment-tab-all"
          type="button"
          role="tab"
          aria-selected={commentCategory === 'all'}
          aria-controls="comment-category-panel"
          className={`min-h-10 shrink-0 rounded-full px-4 text-sm font-semibold ${
            commentCategory === 'all'
              ? 'bg-accent text-white'
              : 'bg-[var(--bg)] text-[var(--muted)]'
          }`}
          onClick={() => setCommentCategory('all')}
        >
          All {comments.length}
        </button>
        {shownCategories.map((category) => (
          <button
            key={category}
            id={`comment-tab-${category}`}
            type="button"
            role="tab"
            aria-selected={commentCategory === category}
            aria-controls="comment-category-panel"
            className={`min-h-10 shrink-0 rounded-full px-4 text-sm font-semibold ${
              commentCategory === category
                ? 'bg-accent text-white'
                : 'bg-[var(--bg)] text-[var(--muted)]'
            }`}
            onClick={() => setCommentCategory(category)}
          >
            {commentCategoryLabel(category)} {categoryCounts.get(category)}
          </button>
        ))}
      </div>
      <ul
        id="comment-category-panel"
        role="tabpanel"
        aria-labelledby={`comment-tab-${commentCategory}`}
      >
        {visibleComments.map((c) => {
          const parent = c.replyToCommentId ? commentsById.get(c.replyToCommentId) : undefined;
          return (
            <li key={c.id} className="flex gap-3 border-b border-[var(--line)] px-4 py-3">
              <Avatar name={c.author.displayName} src={c.author.avatarUrl} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">
                  {c.author.displayName}{' '}
                  <span className="font-normal text-[var(--muted)]">@{c.author.handle}</span>
                </div>
                {c.replyToCommentId ? (
                  <p className="mt-0.5 truncate text-xs text-[var(--muted)]">
                    Replying to {parent ? `@${parent.author.handle}` : 'another comment'}
                    {parent?.body ? ` · ${parent.body}` : ''}
                  </p>
                ) : null}
                {c.body ? (
                  <p className="whitespace-pre-wrap text-[15px] leading-6">{c.body}</p>
                ) : null}
                {c.audioUrl ? (
                  <div className="mt-2">
                    <WaveformPlayer
                      trackId={`c-${c.id}`}
                      src={c.audioUrl}
                      durationMs={c.durationMs ?? 0}
                    />
                  </div>
                ) : null}
                <div className="mt-1 flex items-center gap-4">
                  <button
                    type="button"
                    className="min-h-9 text-xs font-semibold text-[var(--muted)]"
                    onClick={() => {
                      if (!user) {
                        router.push(`/login?next=/post/${id}`);
                        return;
                      }
                      void api(`/comments/${c.id}/like`, {
                        method: c.likedByMe ? 'DELETE' : 'POST',
                        body: c.likedByMe ? undefined : '{}',
                      }).then(load);
                    }}
                  >
                    <span className="inline-flex items-center gap-1">
                      <Heart
                        size={14}
                        strokeWidth={2.75}
                        fill={c.likedByMe ? 'currentColor' : 'none'}
                      />
                      {c.likeCount}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="inline-flex min-h-9 items-center gap-1 text-xs font-semibold text-[var(--muted)]"
                    onClick={() => {
                      if (!user) {
                        router.push(`/login?next=/post/${id}`);
                        return;
                      }
                      setReplyToCommentId(c.id);
                      textRef.current?.focus();
                    }}
                  >
                    <Reply size={14} aria-hidden />
                    Reply
                  </button>
                  {user?.id !== c.author.id ? (
                    <button
                      type="button"
                      className="min-h-9 text-xs font-semibold text-red-600"
                      onClick={() => {
                        if (!user) {
                          router.push(`/login?next=/post/${id}`);
                          return;
                        }
                        setReportComment(c);
                      }}
                    >
                      Report
                    </button>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {reportComment ? (
        <ReportDialog
          targetType="comment"
          targetId={reportComment.id}
          targetLabel="comment"
          onClose={() => setReportComment(null)}
        />
      ) : null}
    </div>
  );
}

function countCommentCategories(comments: CommentCard[]) {
  const counts = new Map<CommentCategory, number>();
  for (const comment of comments) {
    for (const category of new Set(comment.categories)) {
      counts.set(category, (counts.get(category) ?? 0) + 1);
    }
  }
  return counts;
}

function commentCategoryLabel(category: CommentCategory) {
  return category
    .split('_')
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ');
}
