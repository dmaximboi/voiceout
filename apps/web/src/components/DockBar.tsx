'use client';

import dynamic from 'next/dynamic';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Home, Mic, Search, User, Heart, Repeat2, MessageCircle, Bookmark } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useProcessing } from '@/lib/useProcessing';
import { DropBalls, SendBar } from './SendProgress';
import { useNotifications, type DropSignals } from '@/lib/notifications';
import { hasUnreadNotifications } from '@/lib/safetyState';
import { SettingsForm } from './SettingsForm';

const DropsList = dynamic(() => import('./DropsList').then((m) => m.DropsList), {
  ssr: false,
  loading: () => <p className="px-4 py-6 text-sm text-[var(--muted)]">Opening drops.</p>,
});

const PeopleSearch = dynamic(() => import('./PeopleSearch').then((m) => m.PeopleSearch), {
  ssr: false,
  loading: () => <p className="px-4 py-6 text-sm text-[var(--muted)]">Opening search.</p>,
});

const SearchHistory = dynamic(() => import('./SearchHistory').then((m) => m.SearchHistory), {
  ssr: false,
  loading: () => <p className="px-4 py-6 text-sm text-[var(--muted)]">Opening search.</p>,
});

type DockMode = 'idle' | 'drops' | 'search' | 'you';
const sheets: Exclude<DockMode, 'idle'>[] = ['drops', 'search', 'you'];

export function DockBar({
  showMic = false,
  micDocked = false,
  onRecord,
}: {
  showMic?: boolean;
  micDocked?: boolean;
  onRecord?: () => void;
}) {
  const path = usePathname();
  const router = useRouter();
  const { user } = useAuth();
  const { unreadCount, signals } = useNotifications();
  const hasUnread = hasUnreadNotifications(unreadCount);
  const signalIcons = dropSignalIcons(signals);
  const sending = useProcessing();
  const [mode, setMode] = useState<DockMode>('idle');
  const [query, setQuery] = useState('');
  const [drag, setDrag] = useState<{ id: 'search' | 'you'; x: number; y: number } | null>(null);
  const [dropHot, setDropHot] = useState(false);
  const dockRef = useRef<HTMLDivElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const skipClick = useRef(false);
  const gesture = useRef<{ x: number; y: number; kind: 'bar' | 'search' | 'you' | 'sheet' } | null>(
    null,
  );

  const open = mode !== 'idle';
  const onDropsViewed = useCallback(() => undefined, []);

  useEffect(() => {
    setMode('idle');
  }, [path]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMode('idle');
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  function goHome() {
    setMode('idle');
    if (path === '/') {
      window.dispatchEvent(new Event('vo:refresh-feed'));
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    router.push('/');
  }

  function openYou() {
    if (!user) {
      setMode('idle');
      router.push('/login?next=/me');
      return;
    }
    setMode('you');
  }

  function toggleDrops() {
    setMode((m) => (m === 'drops' ? 'idle' : 'drops'));
  }

  function toggleSearch() {
    setMode((m) => (m === 'search' ? 'idle' : 'search'));
  }

  function toggleYou() {
    if (!user) {
      setMode('idle');
      router.push('/login?next=/me');
      return;
    }
    setMode((m) => (m === 'you' ? 'idle' : 'you'));
  }

  function overDrop(x: number, y: number) {
    const box = dropRef.current?.getBoundingClientRect();
    if (!box) return false;
    return x >= box.left - 12 && x <= box.right + 12 && y >= box.top - 16 && y <= box.bottom + 16;
  }

  function onBarDown(e: ReactPointerEvent<HTMLElement>) {
    if ((e.target as HTMLElement).closest('input,textarea,a')) return;
    gesture.current = { x: e.clientX, y: e.clientY, kind: 'bar' };
  }

  function onSheetDown(e: ReactPointerEvent<HTMLElement>) {
    const node = e.currentTarget;
    if (node.scrollTop > 8) return;
    gesture.current = { x: e.clientX, y: e.clientY, kind: 'sheet' };
  }

  function onIconDown(kind: 'search' | 'you', e: ReactPointerEvent<HTMLButtonElement>) {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    gesture.current = { x: e.clientX, y: e.clientY, kind };
  }

  function onPointerMove(e: ReactPointerEvent<HTMLElement>) {
    const g = gesture.current;
    if (!g) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (g.kind === 'search' || g.kind === 'you') {
      if (Math.hypot(dx, dy) < 10 && !drag) return;
      setDrag({ id: g.kind, x: e.clientX, y: e.clientY });
      setDropHot(overDrop(e.clientX, e.clientY));
      return;
    }
    if (Math.abs(dx) < 12 && Math.abs(dy) < 12) return;
    if (g.kind === 'bar') {
      if (Math.abs(dy) > Math.abs(dx) && dy < -36) {
        skipClick.current = true;
        setMode(mode === 'idle' ? 'drops' : mode);
        gesture.current = null;
      } else if (open && Math.abs(dy) > Math.abs(dx) && dy > 36) {
        skipClick.current = true;
        setMode('idle');
        gesture.current = null;
      }
      return;
    }
    if (g.kind === 'sheet') {
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 48 && mode !== 'idle') {
        const i = sheets.indexOf(mode);
        const next = sheets[i + (dx < 0 ? 1 : -1)];
        if (next === 'you') openYou();
        else if (next) setMode(next);
        gesture.current = null;
      } else if (dy > 48 && Math.abs(dy) > Math.abs(dx)) {
        setMode('idle');
        gesture.current = null;
      }
    }
  }

  function onPointerUp(e: ReactPointerEvent<HTMLElement>) {
    const g = gesture.current;
    const dragging = drag;
    gesture.current = null;
    setDrag(null);
    setDropHot(false);
    if (!g) return;
    if ((g.kind === 'search' || g.kind === 'you') && dragging && overDrop(e.clientX, e.clientY)) {
      skipClick.current = true;
      if (g.kind === 'search') setMode('search');
      else openYou();
    } else if (
      (g.kind === 'search' || g.kind === 'you') &&
      dragging &&
      Math.hypot(e.clientX - g.x, e.clientY - g.y) > 12
    ) {
      skipClick.current = true;
    }
  }

  const iconBtn =
    'grid h-11 w-11 shrink-0 place-items-center rounded-full font-semibold text-[var(--text)] active:bg-[var(--bg)]';

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 lg:hidden">
      {open ? (
        <button
          type="button"
          aria-label="Close"
          className="absolute inset-x-0 bottom-full h-[100dvh] bg-black/25"
          onClick={() => setMode('idle')}
        />
      ) : null}

      <div
        ref={dockRef}
        className="relative border-t border-[var(--line)] bg-[var(--card)]/96 shadow-[0_-6px_24px_rgba(10,37,64,0.1)] backdrop-blur-md"
        onPointerDown={onBarDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="flex justify-center pt-1.5" aria-hidden>
          <span className="h-1 w-10 rounded-full bg-[var(--line)]" />
        </div>
        <div
          className="overflow-hidden transition-[max-height] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
          style={{ maxHeight: open ? 'min(62vh, 28rem)' : 0 }}
        >
          <div
            className="max-h-[min(62vh,28rem)] overflow-y-auto overscroll-contain"
            onPointerDown={onSheetDown}
          >
            {mode === 'drops' ? <DropsList onViewed={onDropsViewed} /> : null}
            {mode === 'search' ? (
              query.trim() ? (
                <PeopleSearch query={query} />
              ) : (
                <SearchHistory onSelect={setQuery} />
              )
            ) : null}
            {mode === 'you' ? <SettingsForm compact /> : null}
          </div>
        </div>

        <div className="relative">
          <SendBar />
        </div>
        <div className="mx-auto flex max-w-lg items-center gap-1.5 px-2.5 pb-[calc(0.4rem+env(safe-area-inset-bottom))] pt-2">
          <button type="button" aria-label="Home" className={iconBtn} onClick={goHome}>
            <Home size={22} strokeWidth={path === '/' && mode === 'idle' ? 2.4 : 2} />
          </button>

          <div ref={dropRef} className="min-w-0 flex-1">
            {mode === 'search' ? (
              <label className="flex h-11 items-center rounded-full bg-[var(--bg)] px-4 ring-1 ring-[var(--line)]">
                <input
                  autoFocus
                  className="w-full bg-transparent text-[15px] outline-none"
                  placeholder="Search people"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
            ) : (
              <button
                type="button"
                aria-label={
                  hasUnread
                    ? signalIcons.length
                      ? `Drops: ${signalIcons.map((s) => s.label).join(', ')}`
                      : `Drops, ${unreadCount} unread`
                    : 'Drops'
                }
                aria-expanded={mode === 'drops'}
                onClick={() => {
                  if (skipClick.current) {
                    skipClick.current = false;
                    return;
                  }
                  toggleDrops();
                }}
                className={`flex h-11 w-full items-center justify-center gap-2 rounded-full text-[15px] font-semibold disabled:opacity-80 ${
                  mode === 'drops' || dropHot
                    ? 'bg-accent text-white'
                    : hasUnread && !signalIcons.length
                      ? 'bg-[var(--bg)] text-accent ring-1 ring-accent/35'
                      : 'bg-[var(--bg)] text-[var(--text)] ring-1 ring-[var(--line)]'
                }`}
              >
                {sending ? (
                  <DropBalls />
                ) : dropHot ? (
                  'Drop here'
                ) : signalIcons.length ? (
                  <span className="flex items-center gap-2">
                    {signalIcons.map(({ key, Icon }) => (
                      <Icon
                        key={key}
                        size={18}
                        strokeWidth={2.4}
                        className={mode === 'drops' || dropHot ? 'text-white' : 'text-accent'}
                        fill={key === 'like' || key === 'bookmark' ? 'currentColor' : 'none'}
                        aria-hidden
                      />
                    ))}
                  </span>
                ) : (
                  'Drops'
                )}
              </button>
            )}
          </div>

          <button
            type="button"
            aria-label="Search"
            aria-pressed={mode === 'search'}
            className={`${iconBtn} ${mode === 'search' ? 'text-accent' : ''} ${drag?.id === 'search' ? 'opacity-30' : ''}`}
            onPointerDown={(e) => onIconDown('search', e)}
            onClick={() => {
              if (skipClick.current) {
                skipClick.current = false;
                return;
              }
              toggleSearch();
            }}
          >
            <Search size={22} strokeWidth={mode === 'search' ? 2.4 : 2} />
          </button>

          <button
            type="button"
            aria-label="You"
            aria-pressed={mode === 'you'}
            className={`${iconBtn} ${mode === 'you' ? 'text-accent' : ''} ${drag?.id === 'you' ? 'opacity-30' : ''}`}
            onPointerDown={(e) => onIconDown('you', e)}
            onClick={() => {
              if (skipClick.current) {
                skipClick.current = false;
                return;
              }
              toggleYou();
            }}
          >
            <User size={22} strokeWidth={mode === 'you' ? 2.4 : 2} />
          </button>

          {showMic ? (
            <button
              type="button"
              aria-label="Record a voice"
              onClick={onRecord}
              className={`grid shrink-0 place-items-center overflow-hidden rounded-full bg-accent text-white shadow-md shadow-accent/25 active:scale-95 ${
                micDocked ? 'h-11 w-11 opacity-100' : 'pointer-events-none h-11 w-0 opacity-0'
              }`}
              style={{ transition: 'width 280ms ease, opacity 220ms ease' }}
            >
              <Mic size={22} strokeWidth={2} />
            </button>
          ) : null}
        </div>
      </div>

      {drag ? (
        <span
          className="pointer-events-none fixed z-50 grid h-11 w-11 place-items-center rounded-full bg-[var(--card)] text-[var(--text)] shadow-lg ring-1 ring-[var(--line)]"
          style={{ left: drag.x - 22, top: drag.y - 22 }}
        >
          {drag.id === 'search' ? (
            <Search size={22} strokeWidth={2.4} />
          ) : (
            <User size={22} strokeWidth={2.4} />
          )}
        </span>
      ) : null}
    </nav>
  );
}

function dropSignalIcons(signals: DropSignals) {
  const order = [
    { key: 'like' as const, Icon: Heart, label: 'likes' },
    { key: 'repost' as const, Icon: Repeat2, label: 'reshares' },
    { key: 'comment' as const, Icon: MessageCircle, label: 'comments' },
    { key: 'bookmark' as const, Icon: Bookmark, label: 'bookmarks' },
  ];
  return order.filter((item) => signals[item.key]);
}
