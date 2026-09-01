const OPUS_BITS = 12_000;
const SPEECH_MIME = 'audio/ogg;codecs=opus';
const ENCODER_PATH = '/opus/encoderWorker.min.js';

const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/ogg;codecs=opus',
  'audio/webm',
  'audio/mp4',
];

type RecorderCtor = {
  isRecordingSupported: () => boolean;
  new (config?: Record<string, unknown>): {
    start: () => Promise<void>;
    stop: () => Promise<void>;
    pause: () => Promise<void> | void;
    resume: () => void;
    close: () => Promise<void>;
    ondataavailable: (data: Uint8Array) => void;
  };
};

export type OpusHandle = {
  mime: string;
  stop: () => void;
  pause: () => void;
  resume: () => void;
};

let RecorderMod: RecorderCtor | null = null;
let sharedCtx: AudioContext | null = null;
let warmPromise: Promise<void> | null = null;

export function opusMime() {
  if (typeof MediaRecorder === 'undefined') return 'audio/webm';
  return MIME_CANDIDATES.find((t) => MediaRecorder.isTypeSupported(t)) ?? 'audio/webm';
}

function canPlaySpeechOpus() {
  if (typeof Audio === 'undefined') return false;
  return new Audio().canPlayType('audio/ogg; codecs=opus') !== '';
}

function audioCtx() {
  if (sharedCtx && sharedCtx.state !== 'closed') return sharedCtx;
  sharedCtx = new AudioContext();
  return sharedCtx;
}

export function warmupOpus() {
  if (warmPromise) return warmPromise;
  warmPromise = (async () => {
    void fetch(ENCODER_PATH, { cache: 'force-cache' });
    try {
      const mod = await import('opus-recorder');
      RecorderMod = mod.default as unknown as RecorderCtor;
    } catch {
      RecorderMod = null;
    }
    const ctx = audioCtx();
    if (ctx.audioWorklet) {
      await ctx.audioWorklet.addModule(ENCODER_PATH).catch(() => undefined);
    }
  })();
  return warmPromise;
}

function openMic() {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
}

function watchLevel(analyser: AnalyserNode, onLevel?: (levels: number[]) => void) {
  let raf = 0;
  const bins = new Uint8Array(analyser.frequencyBinCount);
  const tick = () => {
    analyser.getByteFrequencyData(bins);
    onLevel?.(Array.from({ length: 24 }, (_, i) => (bins[i] ?? 0) / 255));
    raf = requestAnimationFrame(tick);
  };
  if (onLevel) tick();
  return () => {
    if (raf) cancelAnimationFrame(raf);
  };
}

export async function startOpusRecording(opts: {
  onStop: (blob: Blob) => void;
  onLevel?: (levels: number[]) => void;
}): Promise<OpusHandle> {
  await warmupOpus();
  const ctx = audioCtx();
  if (ctx.state === 'suspended') await ctx.resume();

  const live = await openMic();
  const source = ctx.createMediaStreamSource(live);
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -18;
  compressor.knee.value = 12;
  compressor.ratio.value = 4;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.25;
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 64;
  source.connect(compressor);
  compressor.connect(analyser);
  const stopLevel = watchLevel(analyser, opts.onLevel);

  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    stopLevel();
    try {
      source.disconnect();
    } catch {
      /* already disconnected by encoder close */
    }
    live.getTracks().forEach((t) => t.stop());
  };

  if (canPlaySpeechOpus() && RecorderMod?.isRecordingSupported()) {
    try {
      return await startVoip(compressor, cleanup, opts.onStop);
    } catch {
      /* MediaRecorder still records the live mic */
    }
  }

  return startMediaRecorder(live, cleanup, opts.onStop);
}

async function startVoip(source: AudioNode, cleanup: () => void, onStop: (blob: Blob) => void) {
  const Recorder = RecorderMod!;
  const rec = new Recorder({
    sourceNode: source,
    encoderPath: ENCODER_PATH,
    numberOfChannels: 1,
    encoderApplication: 2048,
    encoderSampleRate: 16_000,
    encoderBitRate: OPUS_BITS,
    encoderFrameSize: 20,
    encoderComplexity: 8,
    resampleQuality: 5,
    monitorGain: 0,
    recordingGain: 0.85,
  });

  let stopping = false;
  rec.ondataavailable = (data) => {
    cleanup();
    onStop(new Blob([new Uint8Array(data)], { type: SPEECH_MIME }));
  };

  await rec.start();

  return {
    mime: SPEECH_MIME,
    pause() {
      if (stopping) return;
      void rec.pause();
    },
    resume() {
      if (stopping) return;
      rec.resume();
    },
    stop() {
      if (stopping) return;
      stopping = true;
      void rec
        .stop()
        .then(() => rec.close())
        .catch(() => {
          void rec.close();
          cleanup();
        });
    },
  };
}

function startMediaRecorder(live: MediaStream, cleanup: () => void, onStop: (blob: Blob) => void): OpusHandle {
  const mime = opusMime();
  let rec: MediaRecorder;
  try {
    rec = new MediaRecorder(live, { mimeType: mime, audioBitsPerSecond: OPUS_BITS });
  } catch {
    rec = new MediaRecorder(live);
  }
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  rec.onstop = () => {
    cleanup();
    onStop(new Blob(chunks, { type: rec.mimeType || mime }));
  };
  rec.start(1000);
  let stopping = false;
  return {
    mime: rec.mimeType || mime,
    pause() {
      if (stopping || rec.state !== 'recording') return;
      rec.pause();
    },
    resume() {
      if (stopping || rec.state !== 'paused') return;
      rec.resume();
    },
    stop() {
      if (stopping) return;
      stopping = true;
      if (rec.state !== 'inactive') rec.stop();
      else cleanup();
    },
  };
}
