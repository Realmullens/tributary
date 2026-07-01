import { api } from "../api";
import { chunkStore, type LocalTrackMeta } from "./chunk-store";
import { PcmRecorder } from "./pcm-recorder";
import { TrackUploader, type UploadHealth } from "./upload-manager";

const CHUNK_MS = 3000;

const VIDEO_MIME_CANDIDATES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
  "video/mp4;codecs=avc1,mp4a.40.2", // Safari
  "video/mp4",
];
const AUDIO_MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];

export function pickMimeType(hasVideo: boolean): string | null {
  const candidates = hasVideo ? VIDEO_MIME_CANDIDATES : AUDIO_MIME_CANDIDATES;
  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return null;
}

export type QualityPreset = "standard" | "high" | "ultra" | "audio";

export function recorderBitrates(preset: QualityPreset): {
  videoBitsPerSecond?: number;
  audioBitsPerSecond: number;
} {
  switch (preset) {
    case "high":
      return { videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 128_000 };
    case "ultra": // 4K, device permitting — expect ~7× the upload volume of standard
      return { videoBitsPerSecond: 35_000_000, audioBitsPerSecond: 128_000 };
    case "audio":
      return { audioBitsPerSecond: 128_000 };
    default:
      return { videoBitsPerSecond: 5_000_000, audioBitsPerSecond: 128_000 };
  }
}

export type EngineOptions = {
  sessionId: string;
  participantToken: string;
  preset: QualityPreset;
  onAggregateHealth: (health: UploadHealth) => void;
  onError: (message: string) => void;
};

type ActiveTrack = {
  localId: string;
  kind: "camera" | "screen" | "pcm";
  recorder: MediaRecorder | PcmRecorder;
  uploader: TrackUploader;
  chunkIndex: number;
  writeChain: Promise<void>;
  startedAtLocalMs: number | null;
};

/**
 * Local recording engine: one MediaRecorder per source, chunks persisted to
 * IndexedDB before upload, uploads streamed in the background while recording.
 */
export class RecordingEngine {
  private opts: EngineOptions;
  private active = new Map<string, ActiveTrack>();
  private healths = new Map<string, UploadHealth>();
  private uploadsPaused = false;

  constructor(opts: EngineOptions) {
    this.opts = opts;
  }

  /** Defer uploads on constrained bandwidth; local recording continues untouched. */
  setUploadsPaused(paused: boolean): void {
    this.uploadsPaused = paused;
    for (const entry of this.active.values()) entry.uploader.setPaused(paused);
  }

  get isUploadsPaused(): boolean {
    return this.uploadsPaused;
  }

  get isRecording(): boolean {
    return [...this.active.values()].some((t) => t.recorder.state === "recording");
  }

  hasPendingUploads(): boolean {
    const h = this.aggregateHealth();
    return h !== null && h.state !== "complete";
  }

  async startTrack(
    recordingId: string,
    startedAtServerMs: number,
    clockOffsetMs: number,
    kind: "camera" | "screen",
    stream: MediaStream
  ): Promise<void> {
    const hasVideo = stream.getVideoTracks().length > 0;
    const mimeType = pickMimeType(hasVideo);
    if (!mimeType) {
      this.opts.onError("This browser does not support MediaRecorder for the selected media.");
      return;
    }

    const localId = crypto.randomUUID();
    const meta: LocalTrackMeta = {
      localId,
      serverTrackId: null,
      sessionId: this.opts.sessionId,
      recordingId,
      participantToken: this.opts.participantToken,
      type: kind,
      mimeType,
      startOffsetMs: 0,
      finalChunkCount: null,
      finalized: false,
      durationMs: null,
      createdAt: Date.now(),
    };
    await chunkStore.putTrack(meta);

    const uploader = new TrackUploader(meta, {
      onHealth: (h) => {
        this.healths.set(localId, h);
        this.emitAggregate();
      },
      onComplete: () => this.emitAggregate(),
    });

    if (this.uploadsPaused) uploader.setPaused(true);
    const bitrates = recorderBitrates(hasVideo ? this.opts.preset : "audio");
    const recorder = new MediaRecorder(stream, { mimeType, ...bitrates });
    const entry: ActiveTrack = {
      localId,
      kind,
      recorder,
      uploader,
      chunkIndex: 0,
      writeChain: Promise.resolve(),
      startedAtLocalMs: null,
    };
    this.active.set(localId, entry);

    recorder.onstart = () => {
      entry.startedAtLocalMs = Date.now();
      // Map local start time onto the server clock to get this track's timeline offset.
      const startOffsetMs = Math.round(entry.startedAtLocalMs + clockOffsetMs - startedAtServerMs);
      meta.startOffsetMs = startOffsetMs;
      void chunkStore.updateTrack(localId, { startOffsetMs });
      void this.registerServerTrack(meta, uploader, recordingId, kind, mimeType, startOffsetMs);
    };

    recorder.ondataavailable = (event: BlobEvent) => {
      if (!event.data || event.data.size === 0) return;
      const idx = entry.chunkIndex++;
      const blob = event.data;
      entry.writeChain = entry.writeChain.then(async () => {
        await chunkStore.putChunk(localId, idx, blob);
        uploader.enqueue(idx, blob.size);
      });
    };

    recorder.onstop = () => {
      void entry.writeChain.then(() => {
        const durationMs = entry.startedAtLocalMs ? Date.now() - entry.startedAtLocalMs : null;
        uploader.markRecorderDone(entry.chunkIndex, durationMs);
      });
    };

    recorder.onerror = () => {
      this.opts.onError(`Recording error on ${kind} track — captured chunks are preserved.`);
      if (recorder.state !== "inactive") recorder.stop();
    };

    recorder.start(CHUNK_MS);
  }

  private async registerServerTrack(
    meta: LocalTrackMeta,
    uploader: TrackUploader,
    recordingId: string,
    kind: "camera" | "screen" | "pcm",
    mimeType: string,
    startOffsetMs: number,
    attempt = 0
  ): Promise<void> {
    try {
      const res = await api<{ track: { id: string } }>("/api/tracks", {
        token: this.opts.participantToken,
        body: { recordingId, type: kind, mimeType, startOffsetMs },
      });
      meta.serverTrackId = res.track.id;
      await chunkStore.updateTrack(meta.localId, { serverTrackId: res.track.id });
      uploader.setServerTrackId(res.track.id);
    } catch {
      if (attempt < 10) {
        setTimeout(
          () => this.registerServerTrack(meta, uploader, recordingId, kind, mimeType, startOffsetMs, attempt + 1),
          Math.min(1000 * 2 ** attempt, 15_000)
        );
      } else {
        this.opts.onError("Could not register track with server — recording locally; will retry on recovery.");
      }
    }
  }

  /**
   * Uncompressed 48kHz WAV audio track alongside the compressed camera track —
   * captured straight from the mic via AudioWorklet, no codec round-trip.
   */
  async startPcmTrack(
    recordingId: string,
    startedAtServerMs: number,
    clockOffsetMs: number,
    stream: MediaStream
  ): Promise<void> {
    if (stream.getAudioTracks().length === 0) return;
    const recorder = new PcmRecorder(stream);
    const mimeType = `audio/pcm;rate=${recorder.sampleRate};channels=${recorder.channels};format=s16le`;

    const localId = crypto.randomUUID();
    const meta: LocalTrackMeta = {
      localId,
      serverTrackId: null,
      sessionId: this.opts.sessionId,
      recordingId,
      participantToken: this.opts.participantToken,
      type: "pcm",
      mimeType,
      startOffsetMs: 0,
      finalChunkCount: null,
      finalized: false,
      durationMs: null,
      createdAt: Date.now(),
    };
    await chunkStore.putTrack(meta);

    const uploader = new TrackUploader(meta, {
      onHealth: (h) => {
        this.healths.set(localId, h);
        this.emitAggregate();
      },
      onComplete: () => this.emitAggregate(),
    });
    if (this.uploadsPaused) uploader.setPaused(true);

    const entry: ActiveTrack = {
      localId,
      kind: "pcm",
      recorder,
      uploader,
      chunkIndex: 0,
      writeChain: Promise.resolve(),
      startedAtLocalMs: null,
    };
    this.active.set(localId, entry);

    recorder.onstart = () => {
      entry.startedAtLocalMs = Date.now();
      const startOffsetMs = Math.round(entry.startedAtLocalMs + clockOffsetMs - startedAtServerMs);
      meta.startOffsetMs = startOffsetMs;
      void chunkStore.updateTrack(localId, { startOffsetMs });
      void this.registerServerTrack(meta, uploader, recordingId, "pcm", mimeType, startOffsetMs);
    };
    recorder.onchunk = (chunk) => {
      const idx = entry.chunkIndex++;
      entry.writeChain = entry.writeChain.then(async () => {
        await chunkStore.putChunk(localId, idx, chunk.data);
        uploader.enqueue(idx, chunk.data.size);
      });
    };
    recorder.onstop = () => {
      void entry.writeChain.then(() => {
        const durationMs = entry.startedAtLocalMs ? Date.now() - entry.startedAtLocalMs : null;
        uploader.markRecorderDone(entry.chunkIndex, durationMs);
      });
    };

    try {
      await recorder.start();
    } catch (err) {
      this.opts.onError(
        `WAV capture unavailable (${err instanceof Error ? err.message : "AudioWorklet error"}); compressed audio still recording.`
      );
      this.active.delete(localId);
      this.healths.delete(localId);
      await chunkStore.deleteTrack(localId);
    }
  }

  /** Stop the screen-share track only (share ended while recording continues). */
  stopTracksOfKind(kind: "camera" | "screen" | "pcm"): void {
    for (const entry of this.active.values()) {
      if (entry.kind === kind && entry.recorder.state === "recording") {
        entry.recorder.stop();
      }
    }
  }

  stopAll(): void {
    for (const entry of this.active.values()) {
      if (entry.recorder.state === "recording") entry.recorder.stop();
    }
  }

  aggregateHealth(): UploadHealth | null {
    const healths = [...this.healths.values()];
    if (healths.length === 0) return null;
    const uploadedBytes = healths.reduce((s, h) => s + h.uploadedBytes, 0);
    const totalBytes = healths.reduce((s, h) => s + h.totalBytes, 0);
    const queuedChunks = healths.reduce((s, h) => s + h.queuedChunks, 0);
    const order: UploadHealth["state"][] = ["failed", "delayed", "paused", "uploading", "recording", "caught_up", "complete"];
    const state = order.find((s) => healths.some((h) => h.state === s)) ?? "complete";
    return {
      state,
      queuedChunks,
      uploadedBytes,
      totalBytes,
      percent: totalBytes === 0 ? (state === "complete" ? 100 : 0) : Math.min(100, Math.round((uploadedBytes / totalBytes) * 100)),
    };
  }

  private emitAggregate(): void {
    const health = this.aggregateHealth();
    if (health) this.opts.onAggregateHealth(health);
  }
}
