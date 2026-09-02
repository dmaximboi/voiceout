/** Global audio exclusivity: playback and recording must never run together. */

type StopFn = () => void;

const recordStoppers = new Set<StopFn>();
const playPausers = new Set<StopFn>();

export function registerRecorder(stop: StopFn) {
  recordStoppers.add(stop);
  return () => {
    recordStoppers.delete(stop);
  };
}

export function registerPlayerPause(pause: StopFn) {
  playPausers.add(pause);
  return () => {
    playPausers.delete(pause);
  };
}

export function stopAllRecording() {
  for (const stop of [...recordStoppers]) {
    try {
      stop();
    } catch {
      /* ignore */
    }
  }
}

export function pauseAllPlayback() {
  for (const pause of [...playPausers]) {
    try {
      pause();
    } catch {
      /* ignore */
    }
  }
}

export function claimPlayback() {
  stopAllRecording();
}

export function claimRecording() {
  pauseAllPlayback();
}
