import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { db, type RecordingRow, type TrackRow } from "../lib/db.js";
import { newId, requireParticipant } from "../lib/auth.js";
import { chunkPath, trackChunksDir } from "../lib/storage.js";
import { checkTrackUploaded } from "../jobs/pipeline.js";

const createTrackSchema = z.object({
  recordingId: z.string(),
  type: z.enum(["camera", "screen", "pcm"]),
  mimeType: z.string().min(3).max(200),
  startOffsetMs: z.number().int().min(-60_000).max(60 * 60 * 1000),
});

const finalizeSchema = z.object({
  finalChunkCount: z.number().int().min(0).max(1_000_000),
  durationMs: z.number().int().min(0).optional(),
});

function trackForParticipant(trackId: string, participantId: string): TrackRow | null {
  const row = db
    .prepare("SELECT * FROM tracks WHERE id = ? AND participant_id = ?")
    .get(trackId, participantId) as TrackRow | undefined;
  return row ?? null;
}

export function registerTrackRoutes(app: FastifyInstance): void {
  app.post("/api/tracks", async (req, reply) => {
    const participant = requireParticipant(req, reply);
    if (!participant) return;
    const parsed = createTrackSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid track payload" });
    const { recordingId, type, mimeType, startOffsetMs } = parsed.data;

    const recording = db
      .prepare("SELECT * FROM recordings WHERE id = ? AND session_id = ?")
      .get(recordingId, participant.session_id) as RecordingRow | undefined;
    if (!recording) return reply.code(404).send({ error: "Recording not found" });

    const track: TrackRow = {
      id: newId(),
      recording_id: recordingId,
      session_id: participant.session_id,
      participant_id: participant.id,
      type,
      mime_type: mimeType,
      status: "recording",
      start_offset_ms: Math.round(startOffsetMs),
      duration_ms: null,
      size_bytes: 0,
      final_chunk_count: null,
      width: null,
      height: null,
      error: null,
      created_at: Date.now(),
    };
    db.prepare(
      `INSERT INTO tracks (id, recording_id, session_id, participant_id, type, mime_type, status,
         start_offset_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      track.id,
      track.recording_id,
      track.session_id,
      track.participant_id,
      track.type,
      track.mime_type,
      track.status,
      track.start_offset_ms,
      track.created_at
    );
    fs.mkdirSync(trackChunksDir(track.id), { recursive: true });
    return { track: { id: track.id } };
  });

  // Idempotent chunk upload. Raw octet-stream body.
  app.put("/api/tracks/:trackId/chunks/:idx", async (req, reply) => {
    const participant = requireParticipant(req, reply);
    if (!participant) return;
    const { trackId, idx: idxRaw } = req.params as { trackId: string; idx: string };
    const idx = Number.parseInt(idxRaw, 10);
    if (!Number.isInteger(idx) || idx < 0) return reply.code(400).send({ error: "Bad chunk index" });
    const track = trackForParticipant(trackId, participant.id);
    if (!track) return reply.code(404).send({ error: "Track not found" });

    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      return reply.code(400).send({ error: "Empty chunk body" });
    }

    const existing = db
      .prepare("SELECT size_bytes FROM chunks WHERE track_id = ? AND idx = ?")
      .get(trackId, idx) as { size_bytes: number } | undefined;
    if (existing) return { ok: true, duplicate: true };

    const filePath = chunkPath(trackId, idx);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    // Write to temp then rename so a crashed request never leaves a partial chunk.
    const tmpPath = `${filePath}.tmp`;
    fs.writeFileSync(tmpPath, body);
    fs.renameSync(tmpPath, filePath);

    db.prepare(
      "INSERT OR IGNORE INTO chunks (track_id, idx, size_bytes, received_at) VALUES (?, ?, ?, ?)"
    ).run(trackId, idx, body.length, Date.now());
    db.prepare("UPDATE tracks SET size_bytes = size_bytes + ? WHERE id = ?").run(body.length, trackId);

    // If finalize already declared the total, this chunk may complete the upload.
    if (track.final_chunk_count !== null) checkTrackUploaded(trackId);
    return { ok: true };
  });

  // Resume support: which chunks does the server already have?
  app.get("/api/tracks/:trackId/status", async (req, reply) => {
    const participant = requireParticipant(req, reply);
    if (!participant) return;
    const { trackId } = req.params as { trackId: string };
    const track = trackForParticipant(trackId, participant.id);
    if (!track) return reply.code(404).send({ error: "Track not found" });
    const received = db
      .prepare("SELECT idx FROM chunks WHERE track_id = ? ORDER BY idx ASC")
      .all(trackId) as { idx: number }[];
    return {
      status: track.status,
      finalChunkCount: track.final_chunk_count,
      receivedChunks: received.map((r) => r.idx),
    };
  });

  app.post("/api/tracks/:trackId/finalize", async (req, reply) => {
    const participant = requireParticipant(req, reply);
    if (!participant) return;
    const { trackId } = req.params as { trackId: string };
    const track = trackForParticipant(trackId, participant.id);
    if (!track) return reply.code(404).send({ error: "Track not found" });
    const parsed = finalizeSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid finalize payload" });

    db.prepare(
      `UPDATE tracks SET final_chunk_count = ?, duration_ms = COALESCE(?, duration_ms),
         status = CASE WHEN status = 'recording' THEN 'uploading' ELSE status END
       WHERE id = ?`
    ).run(parsed.data.finalChunkCount, parsed.data.durationMs ?? null, trackId);
    checkTrackUploaded(trackId);
    return { ok: true };
  });
}
