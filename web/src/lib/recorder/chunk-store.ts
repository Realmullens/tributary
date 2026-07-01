/**
 * IndexedDB persistence for locally recorded chunks.
 * Invariant: a chunk is written here BEFORE it is queued for upload, and deleted
 * only after the server confirms receipt — so refreshes/crashes never lose media.
 */

export type LocalTrackMeta = {
  localId: string; // key; generated client-side before the server track exists
  serverTrackId: string | null;
  sessionId: string;
  recordingId: string;
  participantToken: string; // needed to resume upload after a refresh
  type: "camera" | "screen";
  mimeType: string;
  startOffsetMs: number;
  finalChunkCount: number | null; // set when the recorder stops
  finalized: boolean; // server acknowledged finalize
  durationMs: number | null;
  createdAt: number;
};

const DB_NAME = "tributary-recorder";
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("tracks")) {
        db.createObjectStore("tracks", { keyPath: "localId" });
      }
      if (!db.objectStoreNames.contains("chunks")) {
        const store = db.createObjectStore("chunks", { keyPath: ["trackLocalId", "idx"] });
        store.createIndex("byTrack", "trackLocalId");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(storeName, mode);
        const req = fn(t.objectStore(storeName));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      })
  );
}

export const chunkStore = {
  async putTrack(meta: LocalTrackMeta): Promise<void> {
    await tx("tracks", "readwrite", (s) => s.put(meta));
  },

  async updateTrack(localId: string, patch: Partial<LocalTrackMeta>): Promise<LocalTrackMeta | null> {
    const existing = (await tx("tracks", "readonly", (s) => s.get(localId))) as
      | LocalTrackMeta
      | undefined;
    if (!existing) return null;
    const updated = { ...existing, ...patch };
    await tx("tracks", "readwrite", (s) => s.put(updated));
    return updated;
  },

  async getTrack(localId: string): Promise<LocalTrackMeta | null> {
    const row = (await tx("tracks", "readonly", (s) => s.get(localId))) as
      | LocalTrackMeta
      | undefined;
    return row ?? null;
  },

  async listTracks(): Promise<LocalTrackMeta[]> {
    return (await tx("tracks", "readonly", (s) => s.getAll())) as LocalTrackMeta[];
  },

  async deleteTrack(localId: string): Promise<void> {
    await tx("tracks", "readwrite", (s) => s.delete(localId));
    const keys = (await tx("chunks", "readonly", (s) =>
      s.index("byTrack").getAllKeys(localId)
    )) as IDBValidKey[];
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction("chunks", "readwrite");
      const store = t.objectStore("chunks");
      for (const key of keys) store.delete(key);
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  },

  async putChunk(trackLocalId: string, idx: number, blob: Blob): Promise<void> {
    await tx("chunks", "readwrite", (s) => s.put({ trackLocalId, idx, blob, size: blob.size }));
  },

  async getChunk(trackLocalId: string, idx: number): Promise<Blob | null> {
    const row = (await tx("chunks", "readonly", (s) => s.get([trackLocalId, idx]))) as
      | { blob: Blob }
      | undefined;
    return row?.blob ?? null;
  },

  async deleteChunk(trackLocalId: string, idx: number): Promise<void> {
    await tx("chunks", "readwrite", (s) => s.delete([trackLocalId, idx]));
  },

  async listChunkIndices(trackLocalId: string): Promise<number[]> {
    const keys = (await tx("chunks", "readonly", (s) =>
      s.index("byTrack").getAllKeys(trackLocalId)
    )) as [string, number][];
    return keys.map((k) => k[1]).sort((a, b) => a - b);
  },

  async pendingBytes(trackLocalId: string): Promise<number> {
    const rows = (await tx("chunks", "readonly", (s) =>
      s.index("byTrack").getAll(trackLocalId)
    )) as { size: number }[];
    return rows.reduce((sum, r) => sum + r.size, 0);
  },
};
