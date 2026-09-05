'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Bell,
  Bookmark,
  ChevronLeft,
  Heart,
  Home,
  LogOut,
  MessageCircle,
  Mic,
  Moon,
  Repeat2,
  Search,
  Settings,
  Sun,
  User,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { AccountMenu } from './AccountMenu';
import { Avatar } from './Avatar';
import { DockBar } from './DockBar';
import { Logo } from './Logo';
import { useNotifications, type DropSignals } from '@/lib/notifications';

export { Avatar } from './Avatar';

const tabs: { href: string; label: string; icon: LucideIcon }[] = [
  { href: '/', label: 'Home', icon: Home },
  { href: '/search', label: 'Search', icon: Search },
  { href: '/record', label: 'Record', icon: Mic },
  { href: '/notifications', label: 'Drops', icon: Bell },
  { href: '/me', label: 'Your posts', icon: User },
];

const hideFabOn = ['/record', '/login', '/register', '/privacy', '/terms', '/admin', '/switch-acct'];
const hideBottomNavOn = ['/login', '/register', '/privacy', '/terms'];

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { user, logout } = useAuth();
  const { unreadCount } = useNotifications();
  const router = useRouter();
  const [docked, setDocked] = useState(false);
  const showMic = !hideFabOn.includes(path);
  const showBottomNav = !hideBottomNavOn.includes(path);
  const atHome = path === '/';

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker.register('/sw.js').then((reg) => {
        reg.active?.postMessage({
          type: 'PREFETCH',
          urls: ['/', '/login', '/register', '/record', '/settings', '/me', '/search', '/trending'],
        });
      });
    }
    const theme = localStorage.getItem('vo-theme');
    if (theme === 'dark' || (!theme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.documentElement.classList.add('dark');
    }
    router.prefetch('/login');
    router.prefetch('/register');
    router.prefetch('/record');
    router.prefetch('/search');
    router.prefetch('/settings');
    router.prefetch('/me');
    router.prefetch('/trending');
  }, [router]);

  useEffect(() => {
    if (user?.handle) router.prefetch(`/u/${user.handle}`);
  }, [router, user?.handle]);

  useEffect(() => {
    function onScroll() {
      const y = window.scrollY;
      setDocked((was) => (was ? y > 40 : y > 120));
    }
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [path]);

  function goRecord() {
    if (!user) {
      router.push('/login');
      return;
    }
    router.push('/record');
  }

  return (
    <div className="min-h-dvh bg-[var(--bg)] text-[var(--text)]">
      <header className="sticky top-0 z-30 bg-[var(--card)]/95 pt-[env(safe-area-inset-top)] backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-1 px-2 sm:px-3">
          <div className="flex w-10 shrink-0 justify-start">
            {atHome ? null : (
              <button
                type="button"
                aria-label="Back"
                className="grid h-9 w-9 place-items-center rounded-full text-[var(--text)] active:bg-[var(--bg)]"
                onClick={() => router.back()}
              >
                <ChevronLeft size={24} strokeWidth={2.5} />
              </button>
            )}
          </div>

          <div className="flex min-w-0 flex-1 justify-center">
            <div className="flex min-h-11 max-w-full items-center rounded-full bg-[var(--bg)] py-0.5 pl-2 pr-1 ring-1 ring-[var(--line)]">
              <Link href="/" className="flex min-w-0 items-center gap-2.5 py-0.5 pl-0.5 pr-2.5 active:opacity-80">
                <span className="flex h-8 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl">
                  <Logo size={40} wide />
                </span>
                <span className="flex min-w-0 flex-col justify-center leading-none">
                  <span className="truncate text-[15px] font-bold tracking-tight text-[var(--text)]">VoiceOut</span>
                  {user ? (
                    <span className="mt-0.5 truncate text-[11px] font-semibold text-[var(--muted)]">
                      {user.displayName.trim().split(/\s+/)[0]}
                    </span>
                  ) : null}
                </span>
              </Link>
              <AccountMenu />
            </div>
          </div>

          <div className="flex w-10 shrink-0 justify-end">
            <ThemeToggle />
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl grid-cols-1 lg:grid-cols-[200px_minmax(0,1fr)] xl:grid-cols-[220px_minmax(0,1fr)_280px] lg:gap-4 xl:gap-6 lg:px-4">
        <aside className="sticky top-[var(--header-h)] hidden h-[calc(100dvh-var(--header-h))] flex-col py-6 lg:flex">
          <nav className="space-y-1">
            {tabs.map((t) => {
              const Icon = t.icon;
              const href = t.href === '/me' && !user ? '/login' : t.href;
              const active = path === t.href || path === href;
              return (
                <Link
                  key={t.href}
                  href={href}
                  onClick={(e) => {
                    if (t.href === '/' && path === '/') {
                      e.preventDefault();
                      window.dispatchEvent(new Event('vo:refresh-feed'));
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }
                  }}
                  className={`flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium active:opacity-80 ${
                    active ? 'bg-accent/10 text-accent' : 'tap-hover'
                  }`}
                >
                  <span className="relative flex items-center gap-1.5">
                    <Icon size={20} strokeWidth={2} />
                    {t.href === '/notifications' && unreadCount > 0 ? (
                      <DropSignalBadges />
                    ) : null}
                  </span>
                  {t.label}
                  {t.href === '/notifications' && unreadCount > 0 ? (
                    <span className="sr-only">, {unreadCount} unread</span>
                  ) : null}
                </Link>
              );
            })}
            {user ? (
              <Link
                href="/settings"
                className={`flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium active:opacity-80 ${
                  path === '/settings' ? 'bg-accent/10 text-accent' : 'tap-hover'
                }`}
              >
                <Settings size={20} strokeWidth={2} />
                You
              </Link>
            ) : null}
          </nav>
          <div className="mt-auto pt-6">
            {user ? (
              <div className="rounded-2xl border border-[var(--line)] p-3">
                <Link href="/me" className="flex min-h-11 items-center gap-2 rounded-xl px-1 active:bg-[var(--bg)]">
                  <Avatar name={user.displayName} src={user.avatarUrl} />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{user.displayName}</div>
                    <div className="truncate text-xs text-[var(--muted)]">@{user.handle}</div>
                  </div>
                </Link>
                <button
                  type="button"
                  onClick={() => void logout().then(() => router.push('/login?switch=1'))}
                  className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-full border border-[var(--line)] text-sm text-red-600 active:bg-[var(--bg)]"
                >
                  <LogOut size={16} strokeWidth={2} />
                  Log out
                </button>
                <button
                  type="button"
                  onClick={() => void logout().then(() => router.push('/login?switch=1'))}
                  className="mt-2 flex min-h-11 w-full items-center justify-center rounded-full border border-[var(--line)] text-sm font-semibold active:bg-[var(--bg)]"
                >
                  Switch account
                </button>
              </div>
            ) : (
              <Link
                href="/login"
                className="flex min-h-11 items-center justify-center rounded-full bg-accent text-sm font-semibold text-white active:opacity-80"
              >
                Log in
              </Link>
            )}
          </div>
        </aside>
        <main
          className={`min-h-[calc(100dvh-var(--header-h))] border-[var(--line)] bg-[var(--card)] lg:border-x lg:pb-16 ${
            showBottomNav ? 'pb-[calc(5.75rem+env(safe-area-inset-bottom))]' : 'pb-16'
          }`}
        >
          {children}
        </main>
        <aside className="sticky top-[var(--header-h)] hidden h-[calc(100dvh-var(--header-h))] overflow-y-auto py-6 xl:block">
          <RightRail />
        </aside>
      </div>

      {showBottomNav ? (
        <DockBar showMic={showMic} micDocked={docked} onRecord={goRecord} />
      ) : null}

      {showMic ? (
        <button
          type="button"
          aria-label="Record a voice"
          onClick={goRecord}
          className={`fixed z-30 grid h-11 w-11 place-items-center rounded-full bg-accent text-white shadow-lg shadow-accent/30 active:scale-95 right-3 bottom-[calc(5.25rem+env(safe-area-inset-bottom))] lg:right-8 lg:bottom-8 lg:pointer-events-auto lg:translate-y-0 lg:scale-100 lg:opacity-100 ${
            docked ? 'pointer-events-none translate-y-14 scale-50 opacity-0' : 'translate-y-0 scale-100 opacity-100'
          }`}
          style={{ transition: 'transform 320ms ease, opacity 280ms ease' }}
        >
          <Mic size={22} strokeWidth={2} />
        </button>
      ) : null}
    </div>
  );
}

function RightRail() {
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4">
        <h2 className="mb-2 font-semibold">Trending voices</h2>
        <p className="text-sm text-[var(--muted)]">Open Trending to hear what the comments are feeling.</p>
        <Link href="/trending" className="mt-3 inline-block text-sm font-medium text-accent">
          See trending
        </Link>
      </div>
      <WhoToFollow />
    </div>
  );
}

type SuggestUser = { id: string; handle: string; displayName: string; avatarUrl: string | null };

function WhoToFollow() {
  const { user } = useAuth();
  const [users, setUsers] = useState<SuggestUser[]>([]);
  useEffect(() => {
    if (!user) {
      setUsers([]);
      return;
    }
    void import('@/lib/api').then(({ api }) =>
      api<{ users: SuggestUser[] }>('/users/suggestions')
        .then((d) => setUsers(d.users))
        .catch(() => setUsers([])),
    );
  }, [user]);
  if (users.length === 0) return null;
  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4">
      <h2 className="mb-3 font-semibold">Who to follow</h2>
      <ul className="space-y-3">
        {users.map((u) => (
          <li key={u.id}>
            <Link href={`/u/${u.handle}`} className="flex min-h-12 items-center gap-2 rounded-xl px-1 active:bg-[var(--bg)]">
              <Avatar name={u.displayName} src={u.avatarUrl} />
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{u.displayName}</div>
                <div className="truncate text-xs text-[var(--muted)]">@{u.handle}</div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'));
  }, []);

  return (
    <button
      type="button"
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      className="grid h-9 w-9 place-items-center rounded-full text-[var(--text)] active:bg-[var(--bg)]"
      onClick={() => {
        const next = document.documentElement.classList.toggle('dark');
        localStorage.setItem('vo-theme', next ? 'dark' : 'light');
        setDark(next);
      }}
    >
      {dark ? <Sun size={20} strokeWidth={2} /> : <Moon size={20} strokeWidth={2} />}
    </button>
  );
}

function DropSignalBadges() {
  const { signals, unreadCount } = useNotifications();
  const icons = dropSidebarIcons(signals);
  if (!icons.length) {
    return (
      <span className="rounded-full bg-accent/15 px-1.5 text-[10px] font-bold text-accent" aria-hidden>
        {unreadCount > 9 ? '9+' : unreadCount}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-0.5 text-accent" aria-hidden>
      {icons.map(({ key, Icon }) => (
        <Icon key={key} size={14} strokeWidth={2.4} fill={key === 'like' || key === 'bookmark' ? 'currentColor' : 'none'} />
      ))}
    </span>
  );
}

function dropSidebarIcons(signals: DropSignals) {
  const order = [
    { key: 'like' as const, Icon: Heart },
    { key: 'repost' as const, Icon: Repeat2 },
    { key: 'comment' as const, Icon: MessageCircle },
    { key: 'bookmark' as const, Icon: Bookmark },
  ];
  return order.filter((item) => signals[item.key]);
}
