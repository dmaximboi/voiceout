const cache = new Map<string, { peaks: number[]; durationMs: number }>();

const POINTS = 96;

export async function audioPeaks(src: string, bars = POINTS): Promise<{ peaks: number[]; durationMs: number }> {
  const hit = cache.get(src);
  if (hit) return hit;
  try {
    const res = await fetch(src);
    if (!res.ok) throw new Error('audio');
    const result = await peaksFromArrayBuffer(await res.arrayBuffer(), bars);
    cache.set(src, result);
    return result;
  } catch {
    return fallbackPeaks(src, bars);
  }
}

export async function peaksFromBlob(blob: Blob, bars = POINTS): Promise<{ peaks: number[]; durationMs: number }> {
  return peaksFromArrayBuffer(await blob.arrayBuffer(), bars);
}

export async function peaksFromArrayBuffer(buf: ArrayBuffer, bars = POINTS): Promise<{ peaks: number[]; durationMs: number }> {
  const ctx = new AudioContext();
  const decoded = await ctx.decodeAudioData(buf.slice(0));
  void ctx.close();
  const channel = decoded.getChannelData(0);
  const size = Math.floor(channel.length / bars) || 1;
  const peaks: number[] = [];
  for (let i = 0; i < bars; i++) {
    let peak = 0;
    const start = i * size;
    const end = Math.min(channel.length, start + size);
    for (let j = start; j < end; j += 4) {
      const v = Math.abs(channel[j] ?? 0);
      if (v > peak) peak = v;
    }
    peaks.push(peak);
  }
  const max = Math.max(...peaks, 0.0001);
  return {
    peaks: peaks.map((p) => 0.08 + (p / max) * 0.92),
    durationMs: Math.round(decoded.duration * 1000),
  };
}

export async function blobDurationMs(blob: Blob): Promise<number> {
  try {
    const { durationMs } = await peaksFromBlob(blob);
    if (durationMs > 0 && Number.isFinite(durationMs)) return durationMs;
  } catch {
    /* webm from MediaRecorder often has no duration header */
  }
  return 0;
}

export function mediaDurationSec(el: HTMLMediaElement, fallbackMs = 0) {
  const native = el.duration;
  if (Number.isFinite(native) && native > 0 && native !== Infinity) return native;
  if (el.seekable.length > 0) {
    const end = el.seekable.end(el.seekable.length - 1);
    if (Number.isFinite(end) && end > 0) return end;
  }
  return fallbackMs > 0 ? fallbackMs / 1000 : 0;
}

function fallbackPeaks(src: string, bars: number) {
  const n = src.split('').reduce((a, c, idx) => a + c.charCodeAt(0) * (idx + 1), 0);
  return {
    peaks: Array.from({ length: bars }, (_, i) => 0.16 + ((Math.sin(n + i * 0.55) + 1) / 2) * 0.7),
    durationMs: 0,
  };
}
