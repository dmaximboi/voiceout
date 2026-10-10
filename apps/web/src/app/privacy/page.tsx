import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalArticle } from '@/components/LegalArticle';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'How VoiceOut collects, uses, shares, and deletes account, media, and usage data.',
};

export default function PrivacyPage() {
  return (
    <LegalArticle title="Privacy Policy" updated="10 October 2026">
      <p>
        This Privacy Policy explains how the operator of VoiceOut (“VoiceOut”, “we”, “us”) collects, uses,
        stores, shares, and deletes personal data when you use the website at{' '}
        <a href="https://voiceout.xyz">voiceout.xyz</a>, the API at api.voiceout.xyz, and related services
        (together, the “Service”).
      </p>
      <p>
        It is written to match what the product actually does today: voice notes, optional photos, follows,
        replies, ranked feeds, optional city and country, paid plans, and automated transcripts. It is a
        notice to you, not a way to opt out of the law. If a statute in your country gives you rights we
        cannot contract away, those rights still apply.
      </p>
      <p>
        Related rules are in the <Link href="/terms">Terms of Use</Link>. Questions:{' '}
        <a href="mailto:privacy@voiceout.xyz">privacy@voiceout.xyz</a>, or Settings after you sign in.
      </p>

      <h2>1. Who is responsible</h2>
      <p>
        The controller of personal data for the live Service at voiceout.xyz is the operator of that site.
        If someone else hosts their own copy of the software, that operator is the controller for that copy
        and this policy does not apply to them.
      </p>
      <p>
        Home markets we designed the Service around are Nigeria and Côte d’Ivoire. People elsewhere may
        still reach the site. Where their local data-protection law applies because they use the Service, we
        treat those mandatory rights as applying in addition to this policy.
      </p>

      <h2>2. What we collect</h2>

      <h3>Account and profile</h3>
      <ul>
        <li>Email address, handle, display name, optional bio, and profile photo if you add one.</li>
        <li>
          Password hash if you use email sign-in. We do not store the password itself. Email may also be
          stored in encrypted form on the account record.
        </li>
        <li>Optional city and country you type, or city and country we resolve if you share device location.</li>
        <li>Language and region hints we infer from captions or bio text you submit, used to rank content.</li>
        <li>Phone number if Telegram shares one at sign-in, used only to keep accounts from colliding.</li>
        <li>Plan tier and paid-plan expiry if you subscribe.</li>
        <li>
          Role, warning, and suspension fields if moderators act on the account. Failed-login count and
          temporary lock time if a password is guessed repeatedly.
        </li>
      </ul>

      <h3>Sign-in identity</h3>
      <ul>
        <li>Email and password you create on VoiceOut.</li>
        <li>
          Google: a provider account id, and usually name and email, only to create and recover the VoiceOut
          account.
        </li>
        <li>
          Telegram: a provider account id, name, and sometimes phone, only to create and recover the
          account. We do not post to Telegram or Google for you.
        </li>
        <li>
          Device-login handoff codes (short-lived) so you can open the same session on a phone. Those codes
          expire.
        </li>
      </ul>

      <h3>Content you publish</h3>
      <ul>
        <li>Voice recordings, captions, optional transcripts, and up to two photos per post.</li>
        <li>Replies (text or voice), reactions, reposts, bookmarks, and follows.</li>
        <li>Content shelf and topic labels we assign from the caption (Idea, Information, News, Education, and similar).</li>
        <li>Share codes used to open a post from a link.</li>
      </ul>

      <h3>Usage and feed ranking</h3>
      <ul>
        <li>
          Events while you are signed in: impressions, seen, open, play, pause, complete, skip, share,
          comment, react, bookmark, follow, and how long you listen (listened milliseconds).
        </li>
        <li>Search queries you run, with a result count. You can clear search history in the product.</li>
        <li>“Not interested” and “hide this author” choices.</li>
        <li>In-app notifications about follows, replies, reactions, and similar activity.</li>
      </ul>

      <h3>Safety, payments, and operations</h3>
      <ul>
        <li>
          Reports you send about a post, comment, or user (reason and optional details), and bug reports
          with optional screenshot.
        </li>
        <li>
          Checkout records and payment-provider events if you buy a plan (we receive payment status from
          Bachs; we do not store full card numbers).
        </li>
        <li>
          Session data: refresh-token hash, user agent, IP address, last seen time, and a device cookie used
          for admin step-up on trusted devices.
        </li>
        <li>
          Audit log rows for security-sensitive actions (for example password change or account erase),
          which may include IP address.
        </li>
        <li>Basic request metadata (IP, user agent, path) used to run the Service, rate-limit abuse, and debug failures.</li>
      </ul>

      <h3>What we do not collect today</h3>
      <ul>
        <li>We do not collect date of birth or government ID. Age is a representation you make in the Terms.</li>
        <li>We do not read your camera roll or microphone except when you choose to record or pick a file.</li>
        <li>We do not sell personal data, and we do not run advertising pixels to sell ads against your profile.</li>
        <li>We do not show other users your email, password hash, phone, or exact coordinates.</li>
      </ul>

      <h2>3. Location</h2>
      <p>
        City and country are optional. You can type them, leave them blank, or tap a “use my location”
        control. If you share coordinates, our servers send latitude and longitude to OpenStreetMap
        Nominatim to turn them into a city and country. We store city and country on your profile, not the
        raw coordinates. Public profiles may show city and country if you set them. You can clear them in
        Settings.
      </p>
      <p>The browser may ask for geolocation permission. You can refuse. The product still works.</p>

      <h2>4. Automated processing and AI</h2>
      <p>Some processing is automated. It is not a human reading every post.</p>
      <ul>
        <li>
          <strong>Transcripts.</strong> After you post, a worker may send audio to our transcription service
          and store a text transcript used for search and ranking. Treat that text as auto-generated. It can
          be wrong.
        </li>
        <li>
          <strong>Caption language and place hints.</strong> We may infer language or a coarse region from
          caption or bio text to rank the feed. We do not use this as a legal address.
        </li>
        <li>
          <strong>Shelves and topics.</strong> Captions are classified into content shelves and topics so
          people can filter the feed.
        </li>
        <li>
          <strong>Comment labels.</strong> Replies may be classified (for example supportive, critical, spam)
          to help ranking and safety. Labels can be wrong.
        </li>
        <li>
          <strong>Feed ranking.</strong> The signed-in feed uses follows, listen history, place, shelves, and
          similar signals. A portion of the feed may surface popular posts from people you follow.
        </li>
      </ul>
      <p>
        We do not use your voice or photos to train a public generative model for other companies. If that
        ever changes, we will update this policy before we do it. Using software tools to write our own
        code is not an in-app AI feature and is not disclosed as one.
      </p>

      <h2>5. How we use data</h2>
      <p>We use personal data to:</p>
      <ul>
        <li>Create and secure your account, keep you signed in, and recover access.</li>
        <li>Store, play, and display content you publish, and show public profiles.</li>
        <li>Rank feeds, search, suggestions (including people near a city you set), and notifications.</li>
        <li>Send account mail (verify email, reset password) when you have an email on the account.</li>
        <li>Process plan payments and unlock paid features.</li>
        <li>Review reports, remove illegal or abusive material, suspend accounts, and defend the Service.</li>
        <li>Measure reliability, stop spam and credential stuffing, and keep rate limits working.</li>
        <li>Comply with a lawful request we are required to obey, or with a court order.</li>
      </ul>
      <p>
        Legal bases we rely on, depending on the country: performance of the contract (running the account
        you asked for), consent (optional location, marketing we do not currently send), legitimate
        interests that do not override your rights (security, ranking, abuse prevention), and legal
        obligation (for example a preservation or disclosure order we cannot lawfully refuse).
      </p>

      <h2>6. Cookies and local storage</h2>
      <p>We use cookies required to run the signed-in product. They are not advertising cookies.</p>
      <ul>
        <li>
          <code>vo_access</code> — short-lived httpOnly session cookie (about one hour).
        </li>
        <li>
          <code>vo_refresh</code> — httpOnly refresh cookie (idle window of seven days).
        </li>
        <li>
          <code>vo_csrf</code> — readable CSRF cookie required for state-changing requests.
        </li>
        <li>
          <code>vo_device</code> — httpOnly device cookie (long-lived) used for admin device recognition.
        </li>
      </ul>
      <p>
        The site may also write small values in sessionStorage or localStorage (for example a one-time
        welcome flag, a feed-refresh hint, or a notice after signup). Those stay on your device. Sign out
        clears session cookies. You can clear site data in the browser.
      </p>
      <p>
        Cloudflare may set its own security or insights cookies if traffic passes through Cloudflare. That
        is described in Cloudflare’s own notices. We do not set a separate advertising cookie.
      </p>

      <h2>7. Who we share data with</h2>
      <p>
        We share data with processors who run the Service for us, and with you when you publish something
        public. We do not sell personal data.
      </p>
      <ul>
        <li>
          <strong>Other users.</strong> Handle, display name, bio, avatar, city/country if set, and posts
          you publish are visible to people using the Service as the product is designed. Share links can
          open a post.
        </li>
        <li>
          <strong>Hosting and data.</strong> Application hosts (including Fly.io and Render), the web host
          (Vercel), database (Neon), object storage for audio and images (Cloudflare R2), and short-lived
          cache/queue storage (Upstash Redis).
        </li>
        <li>
          <strong>Mail.</strong> Resend sends verification and reset mail to the address on the account.
        </li>
        <li>
          <strong>Sign-in providers.</strong> Google and Telegram see whatever you share with them when you
          tap their button. Their policies apply to that hop.
        </li>
        <li>
          <strong>Maps lookup.</strong> OpenStreetMap Nominatim receives coordinates only if you use
          device location.
        </li>
        <li>
          <strong>Payments.</strong> Bachs processes plan checkout. They receive the payment details you
          enter on their page. We receive paid/failed status and a checkout id.
        </li>
        <li>
          <strong>Edge / analytics.</strong> Cloudflare may receive IP addresses for TLS, DDoS protection,
          and optional Web Analytics beacons allowed by our content-security policy.
        </li>
        <li>
          <strong>Fonts.</strong> Display fonts are bundled at build time with Next.js and served from our
          own origin. Visitors should not contact Google Fonts at browse time.
        </li>
        <li>
          <strong>Law enforcement or courts.</strong> If we receive a valid order we are required to obey,
          we may disclose the minimum the order requires. We are not a bank-secrecy vault.
        </li>
      </ul>
      <p>
        Those processors may store data in the EU, the United States, or another region. By using the
        Service you understand that your data can leave the country you are in. We choose processors that
        offer HTTPS and access controls; we do not control every subprocess they use.
      </p>

      <h2>8. How long we keep it</h2>
      <ul>
        <li>Account and published media: until you delete the post or the account, or we remove it for abuse.</li>
        <li>
          Account deletion (Settings → type DELETE): we cryptographically erase the account, delete posts
          and comments you authored, delete media objects we can reach, drop sessions and linked sign-in
          rows, and sign you out. That is irreversible. Backups and logs may hold residues for a short extra
          period, then rotate out.
        </li>
        <li>Failed or rejected uploads may be deleted automatically.</li>
        <li>Session cookies expire on the schedule above; idle sessions are dropped.</li>
        <li>Handoff and one-time codes expire in minutes.</li>
        <li>Search history stays until you clear it or the account is erased.</li>
        <li>
          Payment and security audit rows may be kept longer than the account if we must show that a charge
          happened or that an abuse action was taken.
        </li>
        <li>Reports about illegal content may be kept as needed to handle the report and meet a legal duty.</li>
      </ul>

      <h2>9. Your choices and rights</h2>
      <p>In the product you can:</p>
      <ul>
        <li>Edit profile, city, country, and bio; change or remove the avatar (subject to change cooldowns).</li>
        <li>Delete posts you own (subject to any short delete window the product shows).</li>
        <li>Block or mute accounts, hide an author, or mark a post not interested.</li>
        <li>Clear search history.</li>
        <li>Sign out. Revoke VoiceOut in Google account settings or unlink Telegram access.</li>
        <li>Delete the entire account in Settings by typing DELETE.</li>
        <li>Report a post, comment, or user, and send bug feedback.</li>
      </ul>
      <p>
        Depending on Nigeria’s Data Protection Act 2023, Côte d’Ivoire Law 2013-450, and other laws that
        apply to you, you may also have rights to access, correct, delete, restrict, or object to certain
        processing, and to withdraw consent where processing was based on consent (for example device
        location). We do not currently ship a one-click “export my data” file. Email{' '}
        <a href="mailto:privacy@voiceout.xyz">privacy@voiceout.xyz</a> from the address on the account and
        ask for a copy. We will need to verify it is you.
      </p>
      <p>
        You can complain to a supervisory authority. In Nigeria that includes the Nigeria Data Protection
        Commission. In Côte d’Ivoire that includes ARTCI. In the EEA you may complain to your local data
        protection authority. Doing so does not require our permission.
      </p>

      <h2>10. Children</h2>
      <p>
        VoiceOut is not directed at children under 13. Do not create an account if you are under 13. If the
        law where you live requires a higher age to use a social network (16 or 18 in some places), you must
        meet that age. We do not currently collect date of birth, so we rely on the age statement in the
        Terms and on reports. If we learn an account belongs to a child who is not allowed to use the
        Service, we will delete it.
      </p>
      <p>
        A sentence in the Terms does not replace an age check where a country requires one. If we add date
        of birth later, we will store the minimum needed (for example “is old enough” and the date checked),
        not a scan of an ID, unless a law forces a stronger check.
      </p>

      <h2>11. Security</h2>
      <p>
        We hash passwords, use HTTPS in production, keep secrets in environment variables, use httpOnly
        session cookies, CSRF checks on state-changing requests, and row-level controls on the database. Media
        is scanned or typed before it is served. No method is perfect. Do not reuse passwords. Tell us at{' '}
        <a href="mailto:privacy@voiceout.xyz">privacy@voiceout.xyz</a> if you think an account was taken.
      </p>
      <p>
        If we become aware of a breach that the law says we must report, we will notify the people and
        authorities the applicable law requires, within that law’s deadline (Nigeria’s NDPA and similar
        statutes set notice clocks). Have a way we can reach you: keep a working email on the account.
      </p>

      <h2>12. Public content and search</h2>
      <p>
        Voice notes, captions, photos, and profile fields you publish can be copied by other people, cached
        by browsers, or indexed if a page is public. Deleting a post removes it from the live Service. We
        cannot erase copies other people already downloaded or screenshots they took.
      </p>

      <h2>13. Changes</h2>
      <p>
        We may update this policy when the product or the law changes. The date at the top will change.
        Material changes will be posted on this page. Continued use after the update means you have read the
        new notice. If a change needs fresh consent (for example a new optional location share), we will ask
        in the product.
      </p>

      <h2>14. Contact</h2>
      <p>
        Privacy requests: <a href="mailto:privacy@voiceout.xyz">privacy@voiceout.xyz</a>. Safety reports:
        use the report control on the post, comment, or profile. Account deletion: Settings. Terms:{' '}
        <Link href="/terms">Terms of Use</Link>.
      </p>
    </LegalArticle>
  );
}
