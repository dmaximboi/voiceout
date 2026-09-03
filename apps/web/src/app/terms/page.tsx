import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalArticle } from '@/components/LegalArticle';

export const metadata: Metadata = {
  title: 'Terms of Use · VoiceOut',
  description: 'Rules for using VoiceOut accounts, posts, and sign-in.',
};

export default function TermsPage() {
  return (
    <LegalArticle title="Terms of Use" updated="3 September 2026">
      <p>
        By creating an account or using VoiceOut, you agree to these terms. VoiceOut is a voice-first social
        app for short voice notes, photos on posts, follows, and replies. The live service is at voiceout.xyz.
      </p>
      <h2 className="pt-2 text-lg font-semibold">Accounts</h2>
      <p>
        You may sign in with email and password, Google, or Telegram. You are responsible for activity on your
        account. One person should not impersonate another.
      </p>
      <h2 className="pt-2 text-lg font-semibold">Your content</h2>
      <p>
        You keep ownership of the voices, photos, and text you post. You grant VoiceOut a license to store,
        play, and display that content on the service so other signed-in users can hear and see it as the
        product is designed. You can delete posts you own. You can delete your account in Settings; that
        shreds private identity data and removes your posts from the feed. Deletion may take a short time to
        leave backups.
      </p>
      <h2 className="pt-2 text-lg font-semibold">Acceptable use</h2>
      <p>Do not use VoiceOut to:</p>
      <ul className="list-disc space-y-1 pl-5">
        <li>Post illegal content, including sexual content involving minors.</li>
        <li>Harass, threaten, or incite violence.</li>
        <li>Spam, scrape, or attack the service.</li>
        <li>Upload malware or try to break into other accounts.</li>
        <li>Share someone else&apos;s private recordings without permission.</li>
      </ul>
      <p>We may remove content or suspend accounts that break these rules.</p>
      <h2 className="pt-2 text-lg font-semibold">Sign-in providers</h2>
      <p>
        If you sign in with Google or Telegram, their own terms also apply. We only use that sign-in to
        identify you on VoiceOut. We do not publish to those services for you. Email sign-in requires a
        password you choose and, when enabled, email verification.
      </p>
      <h2 className="pt-2 text-lg font-semibold">Availability</h2>
      <p>
        The service is provided as-is. It may go down, lose data, or change. We are not liable for lost posts
        or lost listening time, except where the law says we cannot limit that.
      </p>
      <h2 className="pt-2 text-lg font-semibold">Age</h2>
      <p>You must be at least 13. If the law in your country requires a higher age, you must meet that age.</p>
      <h2 className="pt-2 text-lg font-semibold">Changes</h2>
      <p>
        We may update these terms. The date at the top will change. Continued use after an update means you
        accept the new terms.
      </p>
      <h2 className="pt-2 text-lg font-semibold">Contact</h2>
      <p>
        Privacy details are in the{' '}
        <Link href="/privacy" className="text-accent">
          Privacy Policy
        </Link>
        . For other questions, use Settings after you sign in, or contact the operator of voiceout.xyz.
      </p>
    </LegalArticle>
  );
}
