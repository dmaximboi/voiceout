import type { Metadata } from 'next';

type Props = { params: Promise<{ id: string }>; children: React.ReactNode };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const origin = process.env.NEXT_PUBLIC_WEB_ORIGIN?.replace(/\/$/, '') || 'https://voiceout.xyz';
  const api = process.env.API_ORIGIN?.replace(/\/$/, '');
  const url = `${origin}/post/${id}`;
  if (!UUID.test(id)) {
    return { title: 'Post · VoiceOut', robots: { index: false, follow: false } };
  }
  if (!api) {
    return { title: 'Post · VoiceOut', alternates: { canonical: url } };
  }
  try {
    const res = await fetch(`${api}/posts/${id}`, { next: { revalidate: 60 } });
    if (res.status === 404) return { title: 'Post · VoiceOut', robots: { index: false, follow: false } };
    if (!res.ok) return { title: 'Post · VoiceOut', alternates: { canonical: url } };
    const data = (await res.json()) as {
      post?: { caption?: string; author?: { displayName?: string }; imageUrls?: string[] };
    };
    const post = data.post;
    const who = post?.author?.displayName || 'Someone';
    const caption = (post?.caption || '').trim();
    const title = `${who} on VoiceOut`;
    const description = caption ? caption.slice(0, 180) : 'Listen to this voice on VoiceOut.';
    const image = post?.imageUrls?.[0];
    return {
      title,
      description,
      alternates: { canonical: url },
      openGraph: {
        title,
        description,
        url,
        type: 'article',
        siteName: 'VoiceOut',
        ...(image ? { images: [{ url: image }] } : {}),
      },
      twitter: {
        card: image ? 'summary_large_image' : 'summary',
        title,
        description,
        ...(image ? { images: [image] } : {}),
      },
    };
  } catch {
    return { title: 'Post · VoiceOut', alternates: { canonical: url } };
  }
}

export default function PostLayout({ children }: Props) {
  return children;
}
