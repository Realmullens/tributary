import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import {
  db,
  type ExportRow,
  type RecordingRow,
  type TrackRow,
  type TranscriptRow,
  type TranscriptSegment,
} from "../lib/db.js";
import { newId, requireUser } from "../lib/auth.js";
import { exportPath, mp4TrackPath, rawTrackPath, wavTrackPath } from "../lib/storage.js";
import { queueMixedExport, reprocessTrack } from "../jobs/pipeline.js";
import { queueTranscription, renderTranscript } from "../jobs/transcribe.js";

function trackOwnedByUser(trackId: string, userId: string): (TrackRow & { participant_name: string }) | null {
  const row = db
    .prepare(
      `SELECT t.*, p.name AS participant_name FROM tracks t
       JOIN sessions s ON s.id = t.session_id
       JOIN studios st ON st.id = s.studio_id
       JOIN participants p ON p.id = t.participant_id
       WHERE t.id = ? AND st.user_id = ?`
    )
    .get(trackId, userId) as (TrackRow & { participant_name: string }) | undefined;
  return row ?? null;
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9-_ ]/g, "").replace(/\s+/g, "-").slice(0, 60) || "track";
}

function streamFile(
  reply: any,
  filePath: string,
  downloadName: string,
  contentType: string
): unknown {
  if (!fs.existsSync(filePath)) {
    return reply.code(404).send({ error: "File not available yet" });
  }
  const stat = fs.statSync(filePath);
  reply.header("Content-Type", contentType);
  reply.header("Content-Length", stat.size);
  reply.header("Content-Disposition", `attachment; filename="${downloadName}"`);
  return reply.send(fs.createReadStream(filePath));
}

export function registerMediaRoutes(app: FastifyInstance): void {
  app.get("/api/tracks/:trackId/download", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const { trackId } = req.params as { trackId: string };
    const { kind } = req.query as { kind?: string };
    const track = trackOwnedByUser(trackId, user.id);
    if (!track) return reply.code(404).send({ error: "Track not found" });

    const base = `${safeName(track.participant_name)}-${track.type}-${trackId.slice(0, 6)}`;
    switch (kind ?? "mp4") {
      case "raw": {
        const ext = track.mime_type.startsWith("audio/pcm")
          ? "pcm"
          : track.mime_type.includes("mp4")
            ? "mp4"
            : "webm";
        return streamFile(reply, rawTrackPath(trackId, ext), `${base}.raw.${ext}`,
          track.mime_type.split(";")[0] || "video/webm");
      }
      case "wav":
        return streamFile(reply, wavTrackPath(trackId), `${base}.wav`, "audio/wav");
      case "mp4":
      default:
        return streamFile(reply, mp4TrackPath(trackId), `${base}.mp4`, "video/mp4");
    }
  });

  app.post("/api/tracks/:trackId/reprocess", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const { trackId } = req.params as { trackId: string };
    const track = trackOwnedByUser(trackId, user.id);
    if (!track) return reply.code(404).send({ error: "Track not found" });
    if (!reprocessTrack(trackId)) {
      return reply.code(409).send({ error: "Track was never finalized; nothing to process" });
    }
    return { ok: true };
  });

  app.post("/api/recordings/:recordingId/exports", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const { recordingId } = req.params as { recordingId: string };
    const body = (req.body ?? {}) as { type?: string };
    const type = body.type === "mixed_audio" ? "mixed_audio" : "mixed_video";

    const recording = db
      .prepare(
        `SELECT r.* FROM recordings r
         JOIN sessions s ON s.id = r.session_id
         JOIN studios st ON st.id = s.studio_id
         WHERE r.id = ? AND st.user_id = ?`
      )
      .get(recordingId, user.id) as RecordingRow | undefined;
    if (!recording) return reply.code(404).send({ error: "Recording not found" });

    const exportRow: ExportRow = {
      id: newId(),
      session_id: recording.session_id,
      recording_id: recordingId,
      type,
      status: "queued",
      format: type === "mixed_video" ? "mp4" : "wav",
      size_bytes: null,
      duration_ms: null,
      error: null,
      created_at: Date.now(),
    };
    db.prepare(
      `INSERT INTO exports (id, session_id, recording_id, type, status, format, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      exportRow.id,
      exportRow.session_id,
      exportRow.recording_id,
      exportRow.type,
      exportRow.status,
      exportRow.format,
      exportRow.created_at
    );
    queueMixedExport(exportRow);
    return { export: exportRow };
  });

  // ---- Transcription ----
  const recordingOwnedByUser = (recordingId: string, userId: string): RecordingRow | null =>
    (db
      .prepare(
        `SELECT r.* FROM recordings r
         JOIN sessions s ON s.id = r.session_id
         JOIN studios st ON st.id = s.studio_id
         WHERE r.id = ? AND st.user_id = ?`
      )
      .get(recordingId, userId) as RecordingRow | undefined) ?? null;

  app.post("/api/recordings/:recordingId/transcribe", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const { recordingId } = req.params as { recordingId: string };
    const recording = recordingOwnedByUser(recordingId, user.id);
    if (!recording) return reply.code(404).send({ error: "Recording not found" });
    const transcript = queueTranscription(recordingId, recording.session_id);
    return { transcript };
  });

  app.get("/api/recordings/:recordingId/transcript", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const { recordingId } = req.params as { recordingId: string };
    if (!recordingOwnedByUser(recordingId, user.id)) {
      return reply.code(404).send({ error: "Recording not found" });
    }
    const transcript = db
      .prepare("SELECT * FROM transcripts WHERE recording_id = ?")
      .get(recordingId) as TranscriptRow | undefined;
    if (!transcript) return reply.code(404).send({ error: "No transcript" });
    return {
      transcript: {
        ...transcript,
        segments: transcript.segments_json ? JSON.parse(transcript.segments_json) : [],
        segments_json: undefined,
      },
    };
  });

  app.get("/api/recordings/:recordingId/transcript/download", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const { recordingId } = req.params as { recordingId: string };
    const { format } = req.query as { format?: string };
    if (!recordingOwnedByUser(recordingId, user.id)) {
      return reply.code(404).send({ error: "Recording not found" });
    }
    const transcript = db
      .prepare("SELECT * FROM transcripts WHERE recording_id = ? AND status = 'ready'")
      .get(recordingId) as TranscriptRow | undefined;
    if (!transcript?.segments_json) return reply.code(404).send({ error: "Transcript not ready" });

    const segments = JSON.parse(transcript.segments_json) as TranscriptSegment[];
    const fmt = format === "srt" ? "srt" : format === "vtt" ? "vtt" : "txt";
    const body = renderTranscript(segments, fmt);
    const contentTypes = { txt: "text/plain", srt: "application/x-subrip", vtt: "text/vtt" };
    reply.header("Content-Type", `${contentTypes[fmt]}; charset=utf-8`);
    reply.header("Content-Disposition", `attachment; filename="transcript-${recordingId.slice(0, 6)}.${fmt}"`);
    return reply.send(body);
  });

  app.get("/api/exports/:exportId/download", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const { exportId } = req.params as { exportId: string };
    const exp = db
      .prepare(
        `SELECT e.* FROM exports e
         JOIN sessions s ON s.id = e.session_id
         JOIN studios st ON st.id = s.studio_id
         WHERE e.id = ? AND st.user_id = ?`
      )
      .get(exportId, user.id) as ExportRow | undefined;
    if (!exp) return reply.code(404).send({ error: "Export not found" });
    const contentType = exp.format === "mp4" ? "video/mp4" : "audio/wav";
    return streamFile(reply, exportPath(exportId, exp.format), `mixed-${exp.type}-${exportId.slice(0, 6)}.${exp.format}`, contentType);
  });
}
