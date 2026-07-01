/**
 * Uncompressed PCM audio capture via AudioWorklet.
 *
 * MediaRecorder can only produce lossy Opus/AAC. For post-production-grade
 * audio we tap the mic with an AudioWorklet, accumulate raw Float32 frames,
 * and emit ~3s chunks of interleaved 16-bit PCM. The server concatenates the
 * chunks and wraps them into a WAV container — a true 48kHz uncompressed
 * recording with no codec round-trip.
 */

const CHUNK_SECONDS = 3;

// Runs on the audio rendering thread; forwards every 128-frame block to us.
const WORKLET_SOURCE = `
class PcmTap extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input.length > 0) {
      // Copy — the engine reuses these buffers between calls.
      this.port.postMessage(input.map((ch) => ch.slice(0)));
    }
    return true;
  }
}
registerProcessor("pcm-tap", PcmTap);
`;

export type PcmChunk = { data: Blob; durationMs: number };

export class PcmRecorder {
  readonly sampleRate: number;
  readonly channels = 2;
  onchunk: ((chunk: PcmChunk) => void) | null = null;
  onstop: (() => void) | null = null;
  onstart: (() => void) | null = null;

  private ctx: AudioContext;
  private stream: MediaStream;
  private node: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private buffers: Float32Array[][] = [];
  private bufferedFrames = 0;
  private stopped = false;
  private started = false;

  constructor(stream: MediaStream) {
    this.stream = stream;
    this.ctx = new AudioContext({ sampleRate: 48000 });
    this.sampleRate = this.ctx.sampleRate; // browser may pin to hardware rate
  }

  get state(): "recording" | "inactive" {
    return this.started && !this.stopped ? "recording" : "inactive";
  }

  async start(): Promise<void> {
    const workletUrl = URL.createObjectURL(
      new Blob([WORKLET_SOURCE], { type: "application/javascript" })
    );
    try {
      await this.ctx.audioWorklet.addModule(workletUrl);
    } finally {
      URL.revokeObjectURL(workletUrl);
    }
    if (this.stopped) return;

    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, "pcm-tap", {
      numberOfInputs: 1,
      numberOfOutputs: 0,
    });
    this.node.port.onmessage = (event: MessageEvent<Float32Array[]>) => {
      if (this.stopped) return;
      this.buffers.push(event.data);
      this.bufferedFrames += event.data[0]?.length ?? 0;
      if (this.bufferedFrames >= this.sampleRate * CHUNK_SECONDS) this.flush();
    };
    this.source.connect(this.node);
    if (this.ctx.state === "suspended") await this.ctx.resume();
    this.started = true;
    this.onstart?.();
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.flush();
    this.source?.disconnect();
    this.node?.port.close();
    void this.ctx.close();
    this.onstop?.();
  }

  /** Convert buffered Float32 blocks to one interleaved s16le chunk. */
  private flush(): void {
    if (this.bufferedFrames === 0) return;
    const frames = this.bufferedFrames;
    const blocks = this.buffers;
    this.buffers = [];
    this.bufferedFrames = 0;

    const out = new Int16Array(frames * this.channels);
    let offset = 0;
    for (const block of blocks) {
      const left = block[0] ?? new Float32Array(0);
      const right = block[1] ?? left; // mono mics duplicate to both channels
      for (let i = 0; i < left.length; i++) {
        out[offset++] = floatToS16(left[i]);
        out[offset++] = floatToS16(right[i] ?? left[i]);
      }
    }
    this.onchunk?.({
      data: new Blob([out.buffer], { type: "application/octet-stream" }),
      durationMs: Math.round((frames / this.sampleRate) * 1000),
    });
  }
}

function floatToS16(v: number): number {
  const clamped = Math.max(-1, Math.min(1, v));
  return Math.round(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff);
}
