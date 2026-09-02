import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalArticle } from '@/components/LegalArticle';

export const metadata: Metadata = {
  title: 'Privacy Policy · VoiceOut',
  description: 'How VoiceOut collects, uses, and stores account and media data.',
};

export default function PrivacyPage() {
  return (
    <LegalArticle title="Privacy Policy" updated="28 August 2026">
      <p>
        VoiceOut is a voice-first social app. You post short voice notes, optional photos, and replies. This
        policy explains what we collect and why.
      </p>
      <h2 className="pt-2 text-lg font-semibold">Who this applies to</h2>
      <p>
        This policy covers the VoiceOut website and API you are using. If you run your own copy of the
        software, that operator is responsible for that copy.
      </p>
      <h2 className="pt-2 text-lg font-semibold">What we collect</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li>Account profile: handle, display name, bio, and avatar if you add one.</li>
        <li>
          Sign-in identity from the provider you choose (Google, GitHub, or TikTok): a provider user id, and
          usually a name. Google and GitHub may also share an email. TikTok typically does not share an email.
        </li>
        <li>Voice recordings, captions, and up to two photos per post, plus replies you make.</li>
        <li>Session cookies so you stay logged in. We do not use them to sell ads.</li>
        <li>Basic request data such as IP address and device type, used to run the service and stop abuse.</li>
        <li>Listen stats on posts you play while signed in, used to rank your feed.</li>
      </ul>
      <h2 className="pt-2 text-lg font-semibold">What we do not do</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li>We do not post on your behalf to Google, GitHub, or TikTok.</li>
        <li>We do not read your camera roll except the files you pick to upload.</li>
        <li>We do not sell your personal data.</li>
        <li>We do not show another user your email or password hash. Public profiles show handle, name, bio, and posts.</li>
      </ul>
      <h2 className="pt-2 text-lg font-semibold">How we use data</h2>
      <p>
        To create your account, keep you signed in, show your feed, store and play media you publish, rank
        posts, send account mail if you set an email, and keep the service safe.
      </p>
      <h2 className="pt-2 text-lg font-semibold">Where data lives</h2>
      <p>
        Profile and post records live in a database. Audio and images live in object storage. Session data may
        also use Redis. Servers may be in the EU or another region depending on how this instance is hosted.
      </p>
      <h2 className="pt-2 text-lg font-semibold">Cookies</h2>
      <p>
        We use httpOnly session cookies and a CSRF cookie required for posting. You can sign out to clear the
        session.
      </p>
      <h2 className="pt-2 text-lg font-semibold">How long we keep it</h2>
      <p>
        We keep account and published media until you delete them or the operator removes the account for
        abuse. Failed uploads may be deleted automatically. Backups may last a short extra period. When you
        delete your account, all your credentials will be lost and will never be regained. That is irreversible.
      </p>
      <h2 className="pt-2 text-lg font-semibold">Your choices</h2>
      <p>
        You can edit your profile, delete posts you own, and log out. You can revoke VoiceOut in your Google,
        GitHub, or TikTok account settings. To delete your account entirely, open Settings, type DELETE, and
        confirm. That is irreversible.
      </p>
      <h2 className="pt-2 text-lg font-semibold">Children</h2>
      <p>VoiceOut is not directed at children under 13. Do not create an account if you are under 13.</p>
      <h2 className="pt-2 text-lg font-semibold">Contact</h2>
      <p>
        Questions about this policy: use Settings after you sign in, or the operator of this VoiceOut site.
        Related rules are in the{' '}
        <Link href="/terms" className="text-accent">
          Terms of Use
        </Link>
        .
      </p>
    </LegalArticle>
  );
}
