'use client';

import { PRESET_STICKERS, type CommentCard, type PostCard } from '@voiceout/shared';
import { Heart, Loader2, Mic, Smile, Square } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, Suspense } from 'react';
import { api, ApiError, uploadAudio } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { startOpusRecording, warmupOpus, type OpusHandle } from '@/lib/recordOpus';
import { FeedCard } from '@/components/FeedCard';
import { WaveformPlayer } from '@/components/WaveformPlayer';
import { Avatar } from '@/components/AppShell';

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
    void api(`/posts/${id}/share-open`, { method: 'POST', body: JSON.stringify({ via }) }).catch(() => undefined);
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
    micLock.current = true;
    setMicBusy(true);
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
      window.setTimeout(() => recRef.current?.stop(), 30_000);
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
      if (voiceBlob) mediaId = await uploadAudio('comment_audio', voiceBlob, 30);
      await api(`/posts/${id}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body: body.trim(), mediaId }),
      });
      setBody('');
      setVoiceBlob(null);
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
  if (missing) return <p className="p-6 text-sm text-[var(--muted)]">This voice is gone or private.</p>;
  if (!post) return <p className="p-6 text-sm text-[var(--muted)]">Loading.</p>;

  return (
    <div>
      <FeedCard post={post} onChange={setPost} />
      {replyError ? <p className="px-4 pt-2 text-sm text-red-600">{replyError}</p> : null}
      <div className="border-b border-[var(--line)] px-3 py-3">
        {user ? (
          <div className="relative">
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
                placeholder="Reply..."
                value={body}
                disabled={recording || micBusy || Boolean(voiceBlob)}
                onChange={(e) => setBody(e.target.value)}
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
                {recording ? 'Recording...' : voiceBlob ? (
                  <button type="button" className="font-semibold" onClick={() => setVoiceBlob(null)}>
                    Voice ready · Undo
                  </button>
                ) : (
                  ''
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
      <ul>
        {comments.map((c) => (
          <li key={c.id} className="flex gap-3 border-b border-[var(--line)] px-4 py-3">
            <Avatar name={c.author.displayName} src={c.author.avatarUrl} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">
                {c.author.displayName} <span className="font-normal text-[var(--muted)]">@{c.author.handle}</span>
              </div>
              {c.body ? <p className="whitespace-pre-wrap text-[15px] leading-6">{c.body}</p> : null}
              {c.audioUrl ? (
                <div className="mt-2">
                  <WaveformPlayer trackId={`c-${c.id}`} src={c.audioUrl} durationMs={c.durationMs ?? 0} />
                </div>
              ) : null}
              <button
                type="button"
                className="mt-1 text-xs font-semibold text-[var(--muted)]"
                onClick={() => {
                  if (!user) {
                    router.push(`/login?next=/post/${id}`);
                    return;
                  }
                  void api(`/comments/${c.id}/like`, { method: c.likedByMe ? 'DELETE' : 'POST', body: c.likedByMe ? undefined : '{}' }).then(load);
                }}
              >
                <span className="inline-flex items-center gap-1">
                  <Heart size={14} strokeWidth={2.75} fill={c.likedByMe ? 'currentColor' : 'none'} />
                  {c.likeCount}
                </span>
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
