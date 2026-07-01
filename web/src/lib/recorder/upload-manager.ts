import { api } from "../api";
import { chunkStore, type LocalTrackMeta } from "./chunk-store";

export type UploadHealth = {
  state: "recording" | "uploading" | "caught_up" | "delayed" | "paused" | "complete" | "failed";
  queuedChunks: number;
  uploadedBytes: number;
  totalBytes: number;
  percent: number;
};

export type TrackUploaderEvents = {
  onHealth?: (health: UploadHealth) => void;
  onComplete?: (localId: string) => void;
};

const MAX_BACKOFF_MS = 30_000;

/**
 * Uploads one local track's chunks to the server, in order, with retry/backoff
 * and resume-after-refresh semantics. Chunks are deleted from IndexedDB only
 * after a confirmed 2xx.
 */
export class TrackUploader {
  private meta: LocalTrackMeta;
  private events: TrackUploaderEvents;
  private queue: number[] = [];
  private uploading = false;
  private stopped = false;
  private paused = false;
  private backoffMs = 1000;
  private failures = 0;
  private uploadedBytes = 0;
  private totalBytes = 0;
  private recorderDone = false;

  constructor(meta: LocalTrackMeta, events: TrackUploaderEvents = {}) {
    this.meta = meta;
    this.events = events;
  }

  get localId(): string {
    return this.meta.localId;
  }

  setServerTrackId(id: string): void {
    this.meta.serverTrackId = id;
    void this.pump();
  }

  /** Called by the recorder for each fresh chunk (already persisted to IndexedDB). */
  enqueue(idx: number, size: number): void {
    this.queue.push(idx);
    this.totalBytes += size;
    this.reportHealth();
    void this.pump();
  }

  /** Recorder stopped; totals are known. */
  markRecorderDone(finalChunkCount: number, durationMs: number | null): void {
    this.recorderDone = true;
    this.meta.finalChunkCount = finalChunkCount;
    this.meta.durationMs = durationMs;
    void chunkStore.updateTrack(this.meta.localId, { finalChunkCount, durationMs });
    void this.pump();
  }

  /**
   * Resume mode: load pending chunk indices from IndexedDB (after refresh),
   * dedupe against what the server already has, then upload the rest.
   */
  async resume(): Promise<void> {
    this.recorderDone = true;
    const pending = await chunkStore.listChunkIndices(this.meta.localId);
    let received = new Set<number>();
    if (this.meta.serverTrackId) {
      try {
        const status = await api<{ receivedChunks: number[] }>(
          `/api/tracks/${this.meta.serverTrackId}/status`,
          { token: this.meta.participantToken }
        );
        received = new Set(status.receivedChunks);
      } catch {
        // Server unreachable — keep everything queued; pump will retry.
      }
    }
    if (this.meta.finalChunkCount === null) {
      // The recording tab died before finalize. Everything captured is what we
      // have: locally persisted chunks plus whatever already reached the server.
      const maxIdx = Math.max(-1, ...pending, ...received);
      this.meta.finalChunkCount = maxIdx + 1;
      await chunkStore.updateTrack(this.meta.localId, { finalChunkCount: this.meta.finalChunkCount });
    }
    for (const idx of pending) {
      if (received.has(idx)) {
        await chunkStore.deleteChunk(this.meta.localId, idx);
      } else {
        const blob = await chunkStore.getChunk(this.meta.localId, idx);
        if (blob) {
          this.queue.push(idx);
          this.totalBytes += blob.size;
        }
      }
    }
    this.queue.sort((a, b) => a - b);
    this.reportHealth();
    void this.pump();
  }

  stop(): void {
    this.stopped = true;
  }

  /** Pause/resume uploads (recording keeps writing chunks locally while paused). */
  setPaused(paused: boolean): void {
    this.paused = paused;
    this.reportHealth();
    if (!paused) void this.pump();
  }

  private async pump(): Promise<void> {
    if (this.uploading || this.stopped || this.paused) return;
    this.uploading = true;
    try {
      while (!this.stopped && !this.paused) {
        if (!this.meta.serverTrackId) return; // wait for track registration
        const idx = this.queue[0];
        if (idx === undefined) {
          if (this.recorderDone && this.meta.finalChunkCount !== null) {
            await this.finalize();
          }
          return;
        }
        const blob = await chunkStore.getChunk(this.meta.localId, idx);
        if (!blob) {
          this.queue.shift();
          continue;
        }
        try {
          const res = await fetch(`/api/tracks/${this.meta.serverTrackId}/chunks/${idx}`, {
            method: "PUT",
            headers: {
              "Content-Type": "application/octet-stream",
              Authorization: `Bearer ${this.meta.participantToken}`,
            },
            body: blob,
          });
          if (!res.ok) throw new Error(`chunk upload ${res.status}`);
          this.queue.shift();
          this.uploadedBytes += blob.size;
          this.backoffMs = 1000;
          this.failures = 0;
          await chunkStore.deleteChunk(this.meta.localId, idx);
          this.reportHealth();
        } catch {
          this.failures++;
          this.reportHealth();
          await sleep(this.backoffMs);
          this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
        }
      }
    } finally {
      this.uploading = false;
    }
  }

  private async finalize(): Promise<void> {
    if (this.meta.finalized || !this.meta.serverTrackId || this.meta.finalChunkCount === null) return;
    try {
      await api(`/api/tracks/${this.meta.serverTrackId}/finalize`, {
        token: this.meta.participantToken,
        body: {
          finalChunkCount: this.meta.finalChunkCount,
          durationMs: this.meta.durationMs ?? undefined,
        },
      });
      this.meta.finalized = true;
      await chunkStore.deleteTrack(this.meta.localId);
      this.reportHealth();
      this.events.onComplete?.(this.meta.localId);
    } catch {
      this.failures++;
      this.reportHealth();
      await sleep(this.backoffMs);
      this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
      void this.pump();
    }
  }

  getHealth(): UploadHealth {
    const done = this.meta.finalized;
    const state: UploadHealth["state"] = done
      ? "complete"
      : this.paused
        ? "paused"
        : this.failures >= 3
        ? "delayed"
        : this.queue.length === 0
          ? this.recorderDone
            ? "uploading" // finalizing
            : "caught_up"
          : this.recorderDone
            ? "uploading"
            : "recording";
    const percent =
      this.totalBytes === 0
        ? done
          ? 100
          : 0
        : Math.min(100, Math.round((this.uploadedBytes / this.totalBytes) * 100));
    return {
      state,
      queuedChunks: this.queue.length,
      uploadedBytes: this.uploadedBytes,
      totalBytes: this.totalBytes,
      percent: done ? 100 : percent,
    };
  }

  private reportHealth(): void {
    this.events.onHealth?.(this.getHealth());
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
