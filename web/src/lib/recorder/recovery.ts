import { chunkStore, type LocalTrackMeta } from "./chunk-store";
import { TrackUploader, type UploadHealth } from "./upload-manager";

export type RecoveryItem = {
  meta: LocalTrackMeta;
  pendingChunks: number;
};

/** Find locally persisted recordings whose upload never completed. */
export async function scanRecoverable(): Promise<RecoveryItem[]> {
  const tracks = await chunkStore.listTracks();
  const items: RecoveryItem[] = [];
  for (const meta of tracks) {
    if (meta.finalized) {
      await chunkStore.deleteTrack(meta.localId);
      continue;
    }
    const pending = await chunkStore.listChunkIndices(meta.localId);
    if (pending.length === 0 && meta.serverTrackId === null) {
      // Nothing captured and never registered — junk from an aborted start.
      await chunkStore.deleteTrack(meta.localId);
      continue;
    }
    items.push({ meta, pendingChunks: pending.length });
  }
  return items;
}

/** Resume uploading every recoverable track. Returns uploaders keyed by localId. */
export function resumeUploads(
  items: RecoveryItem[],
  onHealth: (localId: string, health: UploadHealth) => void,
  onComplete: (localId: string) => void
): TrackUploader[] {
  return items.map((item) => {
    const uploader = new TrackUploader(item.meta, {
      onHealth: (h) => onHealth(item.meta.localId, h),
      onComplete: () => onComplete(item.meta.localId),
    });
    void uploader.resume();
    return uploader;
  });
}
