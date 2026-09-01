declare module 'opus-recorder' {
  export default class Recorder {
    static isRecordingSupported(): boolean;
    constructor(config?: Record<string, unknown>);
    start(): Promise<void>;
    stop(): Promise<void>;
    close(): Promise<void>;
    ondataavailable: (data: Uint8Array) => void;
    onstop: () => void;
  }
}
