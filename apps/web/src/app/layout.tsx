import type { Metadata, Viewport } from 'next';
import { Fraunces } from 'next/font/google';
import { AuthProvider } from '@/lib/auth';
import { PlayerProvider } from '@/lib/player';
import { NotificationsProvider } from '@/lib/notifications';
import { AppShell } from '@/components/AppShell';
import './globals.css';

const avatarFont = Fraunces({
  subsets: ['latin'],
  variable: '--font-avatar',
  display: 'swap',
  weight: ['600', '700'],
  style: ['italic'],
});

const site = 'https://voiceout.xyz';
const description =
  'VoiceOut is a voice-first social network. Record short voice notes, add photos, follow people, and listen in a ranked feed.';

export const metadata: Metadata = {
  metadataBase: new URL(site),
  title: {
    default: 'VoiceOut — voice-first social',
    template: '%s · VoiceOut',
  },
  description,
  applicationName: 'VoiceOut',
  keywords: ['VoiceOut', 'voice social', 'audio posts', 'voice notes', 'social feed'],
  authors: [{ name: 'VoiceOut' }],
  creator: 'VoiceOut',
  manifest: '/manifest.json',
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: site,
    siteName: 'VoiceOut',
    title: 'VoiceOut — voice-first social',
    description,
    images: [{ url: '/logo.png', width: 512, height: 512, alt: 'VoiceOut' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'VoiceOut — voice-first social',
    description,
    images: ['/logo.png'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1 },
  },
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
          <NotificationsProvider>
            <PlayerProvider>
              <AppShell>{children}</AppShell>
            </PlayerProvider>
          </NotificationsProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
