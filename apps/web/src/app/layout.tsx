import type { Metadata, Viewport } from 'next';
import { Fraunces } from 'next/font/google';
import { AuthProvider } from '@/lib/auth';
import { PlayerProvider } from '@/lib/player';
import { AppShell } from '@/components/AppShell';
import './globals.css';

const avatarFont = Fraunces({
  subsets: ['latin'],
  variable: '--font-avatar',
  display: 'swap',
  weight: ['600', '700'],
  style: ['italic'],
});

export const metadata: Metadata = {
  title: 'VoiceOut',
  description: 'Voice-first social feed',
  manifest: '/manifest.json',
  icons: {
    icon: [
      { url: '/logo.png', type: 'image/png' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
  },
  appleWebApp: { capable: true, title: 'VoiceOut', statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  themeColor: '#0a2540',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={avatarFont.variable} suppressHydrationWarning>
      <body>
        <AuthProvider>
          <PlayerProvider>
            <AppShell>{children}</AppShell>
          </PlayerProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
