import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalArticle } from '@/components/LegalArticle';

export const metadata: Metadata = {
  title: 'Terms of Use',
  description: 'Rules for VoiceOut accounts, posts, age, payments, and what these terms cannot waive.',
};

export default function TermsPage() {
  return (
    <LegalArticle title="Terms of Use" updated="10 October 2026">
      <p>
        These Terms of Use are a contract between you and the operator of VoiceOut (“VoiceOut”, “we”, “us”)
        for the website at <a href="https://voiceout.xyz">voiceout.xyz</a>, the API, and related services
        (the “Service”). By creating an account, signing in, or using the Service, you agree to these Terms
        and to the <Link href="/privacy">Privacy Policy</Link>.
      </p>
      <p>
        VoiceOut is a voice-first social app: short voice notes, optional photos, follows, replies, a ranked
        feed, optional city and country, and paid plans.
      </p>

      <h2>1. These Terms do not replace the law</h2>
      <p>
        You cannot, and we cannot, bypass federal, state, or national rules by putting a sentence in a
        website. A clause that says “VoiceOut accepts no responsibility for anything” does not work. It
        does not cancel:
      </p>
      <ul>
        <li>Criminal law (including sexual content involving minors, terrorism, fraud, and similar offences).</li>
        <li>Data-protection duties we have as the operator (for example Nigeria’s Data Protection Act 2023).</li>
        <li>Consumer-protection rules that a country says you cannot waive.</li>
        <li>Copyright, trademark, and takedown duties that apply to a host of user content.</li>
        <li>Tax, payments, and app-store rules if we take money or ship an app build.</li>
        <li>Any licence, registration, or age rule a country applies to social networks operating there.</li>
      </ul>
      <p>
        Where the law says a limit of liability, disclaimer, or class-action waiver is void, that sentence
        is dropped and the rest of these Terms still apply. Where the law lets us limit civil claims for
        ordinary product failures, section 13 does that. That is the most a terms page can honestly do.
      </p>
      <p>
        We do not comply with every statute on Earth by default. We aim to meet the rules of the countries
        we operate and launch in (today: Nigeria and Côte d’Ivoire), the rules of processors and stores we
        use, and the mandatory rights of people who actually use the Service. If we do not offer the Service
        in a country, or we later geo-restrict it, that is a product decision, not a claim that the law of
        that country never applies.
      </p>

      <h2>2. Eligibility and age</h2>
      <p>
        You must be at least 13. If the law where you live requires a higher age to use a social network
        (including 16 or 18 in some countries), you must meet that higher age. By creating an account you
        represent that you meet the required age and that you have authority to agree to these Terms.
      </p>
      <p>
        We do not currently collect date of birth. That representation is not the same as an age-verification
        system. If a country we operate in requires a real age check, we will add it in the product. If we
        learn you are under the required age, we will delete the account.
      </p>
      <p>
        You may not impersonate another person, create an account for someone else without their permission,
        or open a new account to dodge a suspension.
      </p>

      <h2>3. Accounts</h2>
      <p>
        You may sign in with email and password, Google, or Telegram. You are responsible for activity on
        the account until you tell us it was taken and we can lock it. Keep the password to yourself. Email
        sign-in requires a password of at least 10 characters and, when the product requires it, a verified
        email before you can post.
      </p>
      <p>
        Google and Telegram have their own terms. We use those sign-ins only to identify you on VoiceOut. We
        do not publish to those services for you. If Telegram shares a phone number, we may store it to stop
        two VoiceOut accounts from claiming the same phone.
      </p>
      <p>
        You can generate a short-lived device-login link to open the same session on a phone. Anyone who has
        that link can use it until it expires. Do not post it in public.
      </p>
      <p>
        We may lock an account after repeated failed passwords, warn or suspend for abuse, or require extra
        checks for admin tools. We may refuse a handle that impersonates someone or that we reasonably
        believe is reserved.
      </p>

      <h2>4. Your content</h2>
      <p>
        You keep ownership of the voices, photos, captions, and text you post. You grant VoiceOut a
        worldwide, non-exclusive, royalty-free licence to host, store, transcribe, transcode, play, display,
        and distribute that content on the Service, and to make the technical copies ranking, search, backups,
        and sharing require. The licence ends for a piece of content when you delete it or we erase the
        account, except for copies already made by other people, residual backups, and copies we must keep
        for a legal claim or a report of illegal material.
      </p>
      <p>You represent that:</p>
      <ul>
        <li>You made the recording or you have the right to post it, including every voice on it.</li>
        <li>
          Photos you upload (including the profile photo required at signup) are yours, licensed to you, or
          otherwise lawful to use. Do not upload a photo you do not have rights to.
        </li>
        <li>The post does not infringe copyright, trademark, privacy, or publicity rights.</li>
        <li>The post is not illegal where you are, and is not sexual content involving anyone under 18.</li>
      </ul>
      <p>
        You can delete posts you own, subject to any short delete window the product shows. You can delete
        the account in Settings by typing DELETE. Deletion shreds private identity data and removes your
        posts from the live feed. It may take a short time to leave backups. It is irreversible.
      </p>

      <h2>5. Acceptable use</h2>
      <p>Do not use VoiceOut to:</p>
      <ul>
        <li>Post sexual content involving minors, or any content that exploits a child. We will remove it and may report it.</li>
        <li>Harass, threaten, stalk, or incite violence.</li>
        <li>Share someone else’s private recording, nude, or personal data without a lawful basis.</li>
        <li>Post malware, scrape the Service in bulk, attack accounts, or bypass rate limits or security.</li>
        <li>Spam, run a bot farm, or buy or sell engagements.</li>
        <li>Impersonate a person, brand, or government in a way that is likely to deceive.</li>
        <li>Break the criminal law of Nigeria, Côte d’Ivoire, or the country you are in while you post.</li>
      </ul>
      <p>
        We may remove content, limit features, warn, suspend, or erase accounts that break these rules. We
        may do that without a trial on the timeline the product and the law allow. Repeated or severe abuse
        can be a permanent ban.
      </p>

      <h2>6. Reports and takedowns</h2>
      <p>
        Use the report control on a post, comment, or profile. Reasons include spam, abuse, illegal content,
        and other. Moderators can reject a post, remove a comment, warn, or suspend. This is a safety queue,
        not a court.
      </p>
      <p>
        If you are a copyright owner and you believe content on VoiceOut copies your work, email{' '}
        <a href="mailto:privacy@voiceout.xyz">privacy@voiceout.xyz</a> with the URL or share code, a
        description of the work, a statement that you have a good-faith belief the use is not authorised,
        and a statement that the information is accurate. We will remove or restrict material when we have
        a complete notice we are required to act on. If you file a false notice, you may be responsible for
        the harm that causes.
      </p>
      <p>
        We try to act quickly on reports of child sexual abuse material and other illegal content. Speed is
        not a warranty that every item is caught. The Service is not pre-screened end to end.
      </p>

      <h2>7. Automated features</h2>
      <p>
        The Service uses automated systems: speech-to-text transcripts, caption language and shelf labels,
        comment labels, and feed ranking. Those outputs can be wrong. A transcript is not a legal record of
        what you said. A shelf or emotion label is not a judgement about you. We may disclose that a
        transcript or label was auto-generated. Hosting a voice note another person recorded is not the same
        as VoiceOut generating a deepfake; you remain responsible for what you upload.
      </p>

      <h2>8. Paid plans</h2>
      <p>
        Some features (for example longer voice replies) may require a paid plan. Checkout is handled by
        Bachs. Their terms apply to the payment page. Prices and plan length are shown before you pay. A
        paid plan is a limited licence to extra features until the expiry we store on the account. We do
        not store full card numbers.
      </p>
      <p>
        Fees are generally non-refundable except where a consumer law in your country forces a refund right,
        or where we cancel the Service and choose to refund unused time. If a charge fails or is reversed,
        we may remove the paid features.
      </p>

      <h2>9. VoiceOut’s rights</h2>
      <p>
        The VoiceOut name, logo, layout, and software are ours or our licensors’. These Terms do not give
        you a right to copy the app, scrape it, or use our marks on merchandise. Feedback you send (including
        bug reports) may be used to improve the Service without paying you.
      </p>
      <p>
        Login-button marks for Google and Telegram belong to those companies. We display them under their
        brand rules. Images on marketing or landing screens are ours, licensed, or generated for that use.
      </p>

      <h2>10. Availability</h2>
      <p>
        The Service is provided as-is and as-available. It may go down, lose a draft, change a ranking rule,
        or drop a file. We do not promise uninterrupted uptime, that a post will be heard by any number of
        people, or that automated labels will be accurate.
      </p>

      <h2>11. Third-party services</h2>
      <p>
        Google, Telegram, Cloudflare, payment checkout, and map lookup are third parties. If you use their
        buttons or pages, their terms and privacy notices also apply. A failure on their side is not a
        breach of these Terms by us unless the law says otherwise.
      </p>

      <h2>12. Indemnity</h2>
      <p>
        If your content or your use of the Service causes a claim against VoiceOut (including a copyright
        claim, a claim that you recorded someone without consent, or a claim from a payment chargeback you
        caused), you will cover the reasonable losses and legal fees we incur, to the extent the law in
        your country allows an indemnity like this. This does not require you to indemnify us for our own
        fraud or for a duty the law says we cannot pass to you.
      </p>

      <h2>13. Limitation of liability</h2>
      <p>
        To the maximum extent a court will enforce: VoiceOut and its operators are not liable for lost
        profits, lost posts, lost listening time, or indirect or consequential loss. Our total liability for
        claims arising out of the Service is limited to the greater of (a) the amount you paid us for plans
        in the three months before the claim and (b) twenty United States dollars (or the equivalent).
      </p>
      <p>
        This limit does not apply to death or personal injury caused by negligence where that cannot be
        limited, to fraud, or to any liability a statute says we cannot cap. It does not waive criminal or
        regulatory duties. It does not say we are allowed to ignore a child-safety or data-protection
        statute.
      </p>

      <h2>14. Governing law</h2>
      <p>
        These Terms are governed by the laws of the Federal Republic of Nigeria, without regard to
        conflict-of-law rules that would pick a different country’s law for the contract itself. Courts of
        competent jurisdiction in Nigeria may hear disputes about these Terms, except that:
      </p>
      <ul>
        <li>You keep any mandatory consumer or data-protection forum your local law gives you.</li>
        <li>
          We may seek an injunction in any country where a copy of infringing or illegal content is hosted
          or accessed.
        </li>
      </ul>
      <p>
        If you are a consumer in a country that does not allow us to pick Nigeria as the only forum, the
        mandatory courts of that country remain available to you for those consumer claims.
      </p>

      <h2>15. Changes and termination</h2>
      <p>
        We may update these Terms. The date at the top will change. Continued use after an update means you
        accept the new Terms. If you do not accept them, stop using the Service and delete the account.
      </p>
      <p>
        You may stop using VoiceOut at any time. We may stop offering the Service, or your access to it,
        with or without notice if we shut down, if you break these Terms, or if the law requires us to.
        Sections that by nature should survive (licence residues, indemnity, liability limits, governing
        law) survive termination.
      </p>

      <h2>16. Contact</h2>
      <p>
        Privacy details: <Link href="/privacy">Privacy Policy</Link>. Legal and privacy mail:{' '}
        <a href="mailto:privacy@voiceout.xyz">privacy@voiceout.xyz</a>. In-app: Settings after you sign in,
        or the report control on a post.
      </p>
    </LegalArticle>
  );
}
