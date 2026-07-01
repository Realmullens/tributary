import fs from "node:fs";
import {
  db,
  type ExportParams,
  type ExportRow,
  type RecordingRow,
  type TrackRow,
} from "../lib/db.js";
import {
  chunkPath,
  exportPath,
  mp4TrackPath,
  rawTrackPath,
  wavTrackPath,
} from "../lib/storage.js";
import { broadcast } from "../lib/rooms.js";
import {
  mixedAudioExport,
  mixedVideoExport,
  probe,
  rawPcmToWav,
  toMp4,
  toWav,
  type KeepWindow,
  type MixInput,
} from "./ffmpeg.js";

/** Turn trim + cut params into ordered keep windows; undefined = no editing. */
export function computeKeepWindows(
  params: ExportParams,
  totalDurationMs: number
): KeepWindow[] | undefined {
  const clamp = (v: number) => Math.max(0, Math.min(totalDurationMs, Math.round(v)));
  const trimStart = clamp(params.trimStartMs ?? 0);
  const trimEnd = clamp(params.trimEndMs ?? totalDurationMs);
  if (trimEnd <= trimStart) return undefined;

  const cuts = (params.cuts ?? [])
    .map((c) => ({ startMs: clamp(c.startMs), endMs: clamp(c.endMs) }))
    .filter((c) => c.endMs > c.startMs)
    .sort((a, b) => a.startMs - b.startMs);

  const windows: KeepWindow[] = [];
  let cursor = trimStart;
  for (const cut of cuts) {
    if (cut.endMs <= cursor) continue;
    if (cut.startMs > cursor) windows.push({ startMs: cursor, endMs: Math.min(cut.startMs, trimEnd) });
    cursor = Math.max(cursor, cut.endMs);
    if (cursor >= trimEnd) break;
  }
  if (cursor < trimEnd) windows.push({ startMs: cursor, endMs: trimEnd });

  const usable = windows.filter((w) => w.endMs - w.startMs > 50);
  if (usable.length === 0) return undefined;
  if (usable.length === 1 && usable[0].startMs === 0 && usable[0].endMs === totalDurationMs) {
    return undefined; // full range — nothing to edit
  }
  return usable;
}

// ---- Tiny in-process job queue (concurrency 2) ----

type Job = () => Promise<void>;
const queue: Job[] = [];
let running = 0;
const CONCURRENCY = 2;

export function enqueue(job: Job): void {
  queue.push(job);
  pump();
}

function pump(): void {
  while (running < CONCURRENCY && queue.length > 0) {
    const job = queue.shift()!;
    running++;
    job()
      .catch((err) => console.error("[jobs] job failed:", err))
      .finally(() => {
        running--;
        pump();
      });
  }
}

// ---- Track upload completion → processing ----

function getTrack(trackId: string): TrackRow | undefined {
  return db.prepare("SELECT * FROM tracks WHERE id = ?").get(trackId) as TrackRow | undefined;
}

/** Called after finalize and after each chunk once finalized: promote to uploaded + process. */
export function checkTrackUploaded(trackId: string): void {
  const track = getTrack(trackId);
  if (!track || track.final_chunk_count === null) return;
  if (!["uploading", "recording"].includes(track.status)) return;

  const received = (
    db.prepare("SELECT COUNT(*) AS n FROM chunks WHERE track_id = ?").get(trackId) as { n: number }
  ).n;
  if (received < track.final_chunk_count) return;

  db.prepare("UPDATE tracks SET status = 'uploaded' WHERE id = ?").run(trackId);
  notifyTrack(track.session_id, trackId, "uploaded");
  enqueue(() => processTrack(trackId));
}

function notifyTrack(sessionId: string, trackId: string, status: string): void {
  broadcast(sessionId, { t: "track-status", trackId, status });
}

/** Assemble chunks → probe → MP4 + WAV deliverables. */
async function processTrack(trackId: string): Promise<void> {
  const track = getTrack(trackId);
  if (!track) return;
  db.prepare("UPDATE tracks SET status = 'processing' WHERE id = ?").run(trackId);
  notifyTrack(track.session_id, trackId, "processing");

  try {
    const isPcm = track.mime_type.startsWith("audio/pcm");
    const ext = isPcm ? "pcm" : track.mime_type.includes("mp4") ? "mp4" : "webm";
    const rawPath = rawTrackPath(trackId, ext);

    // Concatenate MediaRecorder chunks in order — a valid continuous stream.
    const count = track.final_chunk_count ?? 0;
    const out = fs.createWriteStream(rawPath);
    for (let i = 0; i < count; i++) {
      await new Promise<void>((resolve, reject) => {
        const read = fs.createReadStream(chunkPath(trackId, i));
        read.on("error", reject);
        read.on("end", resolve);
        read.pipe(out, { end: false });
      });
    }
    await new Promise<void>((resolve, reject) => {
      out.on("error", reject);
      out.end(resolve);
    });

    let durationMs = track.duration_ms;
    let width: number | null = null;
    let height: number | null = null;

    if (isPcm) {
      // Headerless s16le stream → wrap into a WAV container.
      const params = new Map(
        track.mime_type
          .split(";")
          .slice(1)
          .map((p) => p.split("=") as [string, string])
      );
      const rate = Number(params.get("rate")) || 48000;
      const channels = Number(params.get("channels")) || 2;
      await rawPcmToWav(rawPath, wavTrackPath(trackId), rate, channels);
      const wavMeta = await probe(wavTrackPath(trackId));
      durationMs = wavMeta.durationMs ?? durationMs;
    } else {
      const meta = await probe(rawPath);
      width = meta.width;
      height = meta.height;
      if (meta.hasVideo) await toMp4(rawPath, mp4TrackPath(trackId), meta.hasAudio);
      if (meta.hasAudio) await toWav(rawPath, wavTrackPath(trackId));

      // Prefer probed duration of the transcoded MP4 (raw webm often reports none).
      durationMs = meta.durationMs ?? durationMs;
      if (meta.hasVideo) {
        const mp4Meta = await probe(mp4TrackPath(trackId));
        durationMs = mp4Meta.durationMs ?? durationMs;
      } else if (meta.hasAudio) {
        const wavMeta = await probe(wavTrackPath(trackId));
        durationMs = wavMeta.durationMs ?? durationMs;
      }
    }

    db.prepare(
      "UPDATE tracks SET status = 'ready', duration_ms = ?, width = ?, height = ?, error = NULL WHERE id = ?"
    ).run(durationMs ?? null, width, height, trackId);
    notifyTrack(track.session_id, trackId, "ready");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[jobs] track ${trackId} processing failed:`, message);
    db.prepare("UPDATE tracks SET status = 'failed', error = ? WHERE id = ?").run(
      message.slice(0, 2000),
      trackId
    );
    notifyTrack(track.session_id, trackId, "failed");
  }
  checkRecordingComplete(track.recording_id);
}

/** Re-run processing for a failed/stuck track (host action from dashboard). */
export function reprocessTrack(trackId: string): boolean {
  const track = getTrack(trackId);
  if (!track || track.final_chunk_count === null) return false;
  enqueue(() => processTrack(trackId));
  return true;
}

/** Settle recording status once all of its tracks reach a terminal state. */
export function checkRecordingComplete(recordingId: string): void {
  const recording = db
    .prepare("SELECT * FROM recordings WHERE id = ?")
    .get(recordingId) as RecordingRow | undefined;
  if (!recording || recording.status === "ready" || recording.status === "recording") return;

  const tracks = db
    .prepare("SELECT status FROM tracks WHERE recording_id = ?")
    .all(recordingId) as { status: string }[];
  if (tracks.some((t) => ["recording", "uploading", "uploaded", "processing"].includes(t.status))) {
    if (recording.status !== "processing" && tracks.some((t) => t.status !== "recording")) {
      db.prepare("UPDATE recordings SET status = 'processing' WHERE id = ?").run(recordingId);
    }
    return;
  }
  const status = tracks.length > 0 && tracks.every((t) => t.status === "failed") ? "failed" : "ready";
  db.prepare("UPDATE recordings SET status = ? WHERE id = ?").run(status, recordingId);
  broadcast(recording.session_id, { t: "recording-ready", recordingId, status });
}

// ---- Mixed exports ----

export function queueMixedExport(exportRow: ExportRow): void {
  enqueue(() => renderExport(exportRow.id));
}

async function renderExport(exportId: string): Promise<void> {
  const exp = db.prepare("SELECT * FROM exports WHERE id = ?").get(exportId) as ExportRow | undefined;
  if (!exp) return;
  db.prepare("UPDATE exports SET status = 'processing' WHERE id = ?").run(exportId);
  broadcast(exp.session_id, { t: "export-status", exportId, status: "processing" });

  try {
    const tracks = db
      .prepare(
        `SELECT t.*, p.name AS participant_name FROM tracks t
         JOIN participants p ON p.id = t.participant_id
         WHERE t.recording_id = ? AND t.status = 'ready' ORDER BY t.created_at ASC`
      )
      .all(exp.recording_id) as (TrackRow & { participant_name: string })[];
    if (tracks.length === 0) throw new Error("No ready tracks for this recording");

    // When a participant has an uncompressed PCM track, use it as their audio
    // source and mute their camera track's (lossy) audio to avoid doubling.
    const participantsWithPcm = new Set(
      tracks.filter((t) => t.type === "pcm").map((t) => t.participant_id)
    );

    const inputs: MixInput[] = [];
    let totalDurationMs = 0;
    for (const track of tracks) {
      const hasVideo = track.width !== null;
      const filePath = hasVideo
        ? mp4TrackPath(track.id)
        : wavTrackPath(track.id);
      if (!fs.existsSync(filePath)) continue;
      const offsetMs = Math.max(0, track.start_offset_ms);
      const audioSuperseded =
        track.type === "camera" && participantsWithPcm.has(track.participant_id);
      inputs.push({
        filePath,
        offsetMs,
        hasVideo,
        hasAudio: fs.existsSync(wavTrackPath(track.id)) && !audioSuperseded,
        label: track.participant_name,
      });
      totalDurationMs = Math.max(totalDurationMs, offsetMs + (track.duration_ms ?? 0));
    }
    if (inputs.length === 0 || totalDurationMs === 0) throw new Error("No usable track files");

    const params: ExportParams = exp.params_json ? JSON.parse(exp.params_json) : {};
    const keepWindows = computeKeepWindows(params, totalDurationMs);
    const outputDurationMs = keepWindows
      ? keepWindows.reduce((s, w) => s + (w.endMs - w.startMs), 0)
      : totalDurationMs;

    const outPath = exportPath(exportId, exp.format);
    if (exp.type === "mixed_video") {
      await mixedVideoExport(inputs, outPath, totalDurationMs, keepWindows);
    } else {
      await mixedAudioExport(inputs, outPath, totalDurationMs, keepWindows);
    }
    const size = fs.statSync(outPath).size;
    db.prepare(
      "UPDATE exports SET status = 'ready', size_bytes = ?, duration_ms = ?, error = NULL WHERE id = ?"
    ).run(size, outputDurationMs, exportId);
    broadcast(exp.session_id, { t: "export-status", exportId, status: "ready" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[jobs] export ${exportId} failed:`, message);
    db.prepare("UPDATE exports SET status = 'failed', error = ? WHERE id = ?").run(
      message.slice(0, 2000),
      exportId
    );
    broadcast(exp.session_id, { t: "export-status", exportId, status: "failed" });
  }
}
