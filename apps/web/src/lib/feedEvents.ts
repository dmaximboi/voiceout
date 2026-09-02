'use client';

import type { FeedEventType } from '@voiceout/shared';
import { api } from './api';

type Event = {
  eventType: Extract<FeedEventType, 'play' | 'complete' | 'share' | 'react' | 'bookmark'>;
  postId: string;
  source?: string;
};

const recent = new Map<string, number>();

export function emitFeedEvent(event: Event) {
  if (!/^[0-9a-f-]{36}$/i.test(event.postId)) return;
  const key = `${event.eventType}:${event.postId}`;
  const now = Date.now();
  const ttl = event.eventType === 'play' ? 30_000 : 2_000;
  if (now - (recent.get(key) ?? 0) < ttl) return;
  recent.set(key, now);
  if (recent.size > 200) {
    for (const [candidate, at] of recent) if (now - at > 60_000) recent.delete(candidate);
  }
  void api('/feed/events', {
    method: 'POST',
    body: JSON.stringify({ events: [event] }),
  }).catch(() => undefined);
}
