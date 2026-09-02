import { opusMime } from './recordOpus';

/** 16 kHz / ~20 kbps keeps voice notes WhatsApp-sized. */
const PROCESS_RATE = 16_000;
const STUDIO_OPUS_BITS = 20_000;

export type StudioSettings = {
  trimStart: number;
  trimEnd: number;
  boost: number;
};

export const DEFAULT_STUDIO: StudioSettings = {
  trimStart: 0,
  trimEnd: 1,
  boost: 0,
};

export async function applyVoiceStudio(blob: Blob, settings: StudioSettings) {
  const ctx = new AudioContext();
  const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
  await ctx.close();

  const mono = mergeMono(decoded);
  const trimmed = sliceBuffer(mono, settings.trimStart, settings.trimEnd);
  const working = await resampleBuffer(trimmed, PROCESS_RATE);
  const rendered = await renderBoost(working, PROCESS_RATE, settings.boost);
  const encoded = await encodeOpus(rendered);
  return { blob: encoded, durationMs: Math.round(rendered.duration * 1000) };
}

async function resampleBuffer(buffer: AudioBuffer, targetRate: number) {
  if (buffer.sampleRate === targetRate) return buffer;
  const length = Math.max(1, Math.round(buffer.duration * targetRate));
  const offline = new OfflineAudioContext(1, length, targetRate);
  const src = offline.createBufferSource();
  src.buffer = mergeMono(buffer);
  src.connect(offline.destination);
  src.start(0);
  return offline.startRendering();
}

function sliceBuffer(buffer: AudioBuffer, startRatio: number, endRatio: number) {
  const start = Math.max(0, Math.min(buffer.length, Math.floor(buffer.length * clamp01(startRatio))));
  const end = Math.max(start + 1, Math.min(buffer.length, Math.floor(buffer.length * clamp01(endRatio))));
  const out = new AudioBuffer({ length: end - start, numberOfChannels: 1, sampleRate: buffer.sampleRate });
  out.getChannelData(0).set(mergeMono(buffer).getChannelData(0).subarray(start, end));
  return out;
}

async function renderBoost(buffer: AudioBuffer, sampleRate: number, boost: number) {
  if (boost < 0.01) return buffer;
  const offline = new OfflineAudioContext(1, buffer.length, sampleRate);
  const src = offline.createBufferSource();
  src.buffer = buffer;
  const gain = offline.createGain();
  gain.gain.value = Math.pow(10, (boost * 18) / 20);
  const comp = offline.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.knee.value = 8;
  comp.ratio.value = 4;
  comp.attack.value = 0.003;
  comp.release.value = 0.15;
  src.connect(gain);
  gain.connect(comp);
  comp.connect(offline.destination);
  src.start(0);
  return offline.startRendering();
}

function mergeMono(buffer: AudioBuffer) {
  if (buffer.numberOfChannels === 1) return buffer;
  const out = new AudioBuffer({ length: buffer.length, numberOfChannels: 1, sampleRate: buffer.sampleRate });
  const dest = out.getChannelData(0);
  for (let i = 0; i < buffer.length; i++) {
    let sum = 0;
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) sum += buffer.getChannelData(ch)[i] ?? 0;
    dest[i] = sum / buffer.numberOfChannels;
  }
  return out;
}

async function encodeOpus(buffer: AudioBuffer) {
  const ctx = new AudioContext({ sampleRate: buffer.sampleRate });
  const dest = ctx.createMediaStreamDestination();
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(dest);
  const mime = opusMime();
  const rec = new MediaRecorder(dest.stream, { mimeType: mime, audioBitsPerSecond: STUDIO_OPUS_BITS });
  const chunks: Blob[] = [];
  rec.ondataavailable = (ev) => {
    if (ev.data.size) chunks.push(ev.data);
  };
  const done = new Promise<Blob>((resolve, reject) => {
    rec.onstop = () => resolve(new Blob(chunks, { type: mime }));
    rec.onerror = () => reject(new Error('Could not encode audio'));
  });
  rec.start(250);
  src.start();
  await new Promise<void>((resolve) => {
    src.onended = () => resolve();
  });
  await new Promise((r) => setTimeout(r, 40));
  rec.stop();
  const blob = await done;
  await ctx.close();
  return blob;
}

function clamp01(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}
