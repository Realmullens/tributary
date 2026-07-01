import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  db,
  type ParticipantRow,
  type RecordingRow,
  type SessionRow,
} from "../lib/db.js";
import { newId, requireUser } from "../lib/auth.js";
import { newToken } from "../lib/ids.js";
import { startRecording, stopRecording } from "../lib/recording.js";
import { sessionOwnedByUser } from "./studios.js";

const joinSchema = z.object({ name: z.string().min(1).max(80) });

export function registerSessionRoutes(app: FastifyInstance): void {
  // ---- Host: session detail ----
  app.get("/api/sessions/:sessionId", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const { sessionId } = req.params as { sessionId: string };
    const session = sessionOwnedByUser(sessionId, user.id);
    if (!session) return reply.code(404).send({ error: "Session not found" });

    const participants = db
      .prepare("SELECT id, name, role, joined_at, left_at FROM participants WHERE session_id = ?")
      .all(sessionId);
    const recordings = db
      .prepare("SELECT * FROM recordings WHERE session_id = ? ORDER BY started_at_ms DESC")
      .all(sessionId) as RecordingRow[];
    const tracks = db
      .prepare(
        `SELECT t.*, p.name AS participant_name,
           (SELECT COUNT(*) FROM chunks c WHERE c.track_id = t.id) AS received_chunks
         FROM tracks t JOIN participants p ON p.id = t.participant_id
         WHERE t.session_id = ? ORDER BY t.created_at ASC`
      )
      .all(sessionId);
    const exports = db
      .prepare("SELECT * FROM exports WHERE session_id = ? ORDER BY created_at DESC")
      .all(sessionId);
    const transcripts = db
      .prepare(
        "SELECT id, recording_id, status, language, error, created_at FROM transcripts WHERE session_id = ?"
      )
      .all(sessionId);
    return { session, participants, recordings, tracks, exports, transcripts };
  });

  // ---- Host: join own session as a room participant ----
  app.post("/api/sessions/:sessionId/host-join", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const { sessionId } = req.params as { sessionId: string };
    const session = sessionOwnedByUser(sessionId, user.id);
    if (!session) return reply.code(404).send({ error: "Session not found" });

    // Reuse the host participant row across visits so recovery + identity are stable.
    let participant = db
      .prepare("SELECT * FROM participants WHERE session_id = ? AND role = 'host' AND user_id = ?")
      .get(sessionId, user.id) as ParticipantRow | undefined;
    if (!participant) {
      participant = {
        id: newId(),
        session_id: sessionId,
        user_id: user.id,
        name: user.name,
        role: "host",
        token: newToken(),
        created_at: Date.now(),
        joined_at: null,
        left_at: null,
      };
      db.prepare(
        `INSERT INTO participants (id, session_id, user_id, name, role, token, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        participant.id,
        participant.session_id,
        participant.user_id,
        participant.name,
        participant.role,
        participant.token,
        participant.created_at
      );
    }
    db.prepare("UPDATE sessions SET status = 'live' WHERE id = ? AND status = 'created'").run(sessionId);
    return {
      participant: { id: participant.id, name: participant.name, role: participant.role },
      token: participant.token,
      session: { id: session.id, title: session.title },
    };
  });

  // ---- Guest: inspect invite ----
  app.get("/api/join/:inviteToken", async (req, reply) => {
    const { inviteToken } = req.params as { inviteToken: string };
    const session = db
      .prepare("SELECT * FROM sessions WHERE invite_token = ?")
      .get(inviteToken) as SessionRow | undefined;
    if (!session) return reply.code(404).send({ error: "Invite link is invalid" });
    if (session.ended_at) return reply.code(410).send({ error: "This session has ended" });
    const studio = db.prepare("SELECT name FROM studios WHERE id = ?").get(session.studio_id) as
      | { name: string }
      | undefined;
    return {
      session: { id: session.id, title: session.title, status: session.status },
      studioName: studio?.name ?? "Studio",
    };
  });

  // ---- Guest: join via invite (creates participant, returns bearer token) ----
  app.post("/api/join/:inviteToken", async (req, reply) => {
    const { inviteToken } = req.params as { inviteToken: string };
    const session = db
      .prepare("SELECT * FROM sessions WHERE invite_token = ?")
      .get(inviteToken) as SessionRow | undefined;
    if (!session) return reply.code(404).send({ error: "Invite link is invalid" });
    if (session.ended_at) return reply.code(410).send({ error: "This session has ended" });
    const parsed = joinSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Please enter your name" });

    const participant: ParticipantRow = {
      id: newId(),
      session_id: session.id,
      user_id: null,
      name: parsed.data.name,
      role: "guest",
      token: newToken(),
      created_at: Date.now(),
      joined_at: null,
      left_at: null,
    };
    db.prepare(
      `INSERT INTO participants (id, session_id, user_id, name, role, token, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      participant.id,
      participant.session_id,
      participant.user_id,
      participant.name,
      participant.role,
      participant.token,
      participant.created_at
    );
    return {
      participant: { id: participant.id, name: participant.name, role: participant.role },
      token: participant.token,
      session: { id: session.id, title: session.title },
    };
  });

  // ---- Participant: validate a stored token (recovery/refresh path) ----
  app.get("/api/participants/me", async (req, reply) => {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return reply.code(401).send({ error: "Missing token" });
    const participant = db
      .prepare("SELECT * FROM participants WHERE token = ?")
      .get(token) as ParticipantRow | undefined;
    if (!participant) return reply.code(401).send({ error: "Invalid token" });
    const session = db
      .prepare("SELECT id, title, status, ended_at FROM sessions WHERE id = ?")
      .get(participant.session_id) as Pick<SessionRow, "id" | "title" | "status" | "ended_at">;
    return {
      participant: { id: participant.id, name: participant.name, role: participant.role },
      session,
    };
  });

  // ---- Session settings (host only) ----
  app.patch("/api/sessions/:sessionId", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const { sessionId } = req.params as { sessionId: string };
    const session = sessionOwnedByUser(sessionId, user.id);
    if (!session) return reply.code(404).send({ error: "Session not found" });
    const body = (req.body ?? {}) as { autoRecord?: boolean };
    if (typeof body.autoRecord === "boolean") {
      db.prepare("UPDATE sessions SET auto_record = ? WHERE id = ?").run(
        body.autoRecord ? 1 : 0,
        sessionId
      );
    }
    return { ok: true };
  });

  // ---- Recording control (host only) ----
  app.post("/api/sessions/:sessionId/recording/start", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const { sessionId } = req.params as { sessionId: string };
    const session = sessionOwnedByUser(sessionId, user.id);
    if (!session) return reply.code(404).send({ error: "Session not found" });
    const body = (req.body ?? {}) as { countdownSeconds?: number };
    const result = startRecording(sessionId, body.countdownSeconds ?? 3);
    if (!result.ok) return reply.code(409).send({ error: result.error });
    return result;
  });

  app.post("/api/sessions/:sessionId/recording/stop", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const { sessionId } = req.params as { sessionId: string };
    const session = sessionOwnedByUser(sessionId, user.id);
    if (!session) return reply.code(404).send({ error: "Session not found" });
    const result = stopRecording(sessionId);
    if (!result.ok) return reply.code(409).send({ error: result.error ?? "Not recording" });
    return { ok: true };
  });
}
