import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db, type SessionRow, type StudioRow } from "../lib/db.js";
import { newId, requireUser } from "../lib/auth.js";
import { newToken } from "../lib/ids.js";

const nameSchema = z.object({ name: z.string().min(1).max(120) });
const sessionSchema = z.object({ title: z.string().min(1).max(200) });

export function studioForUser(studioId: string, userId: string): StudioRow | null {
  const row = db
    .prepare("SELECT * FROM studios WHERE id = ? AND user_id = ?")
    .get(studioId, userId) as StudioRow | undefined;
  return row ?? null;
}

export function sessionOwnedByUser(sessionId: string, userId: string): SessionRow | null {
  const row = db
    .prepare(
      `SELECT s.* FROM sessions s JOIN studios st ON st.id = s.studio_id
       WHERE s.id = ? AND st.user_id = ?`
    )
    .get(sessionId, userId) as SessionRow | undefined;
  return row ?? null;
}

export function registerStudioRoutes(app: FastifyInstance): void {
  app.get("/api/studios", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const studios = db
      .prepare(
        `SELECT s.*, (SELECT COUNT(*) FROM sessions WHERE studio_id = s.id) AS session_count
         FROM studios s WHERE s.user_id = ? ORDER BY s.created_at DESC`
      )
      .all(user.id);
    return { studios };
  });

  app.post("/api/studios", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const parsed = nameSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Studio name is required" });
    const studio: StudioRow = {
      id: newId(),
      user_id: user.id,
      name: parsed.data.name,
      created_at: Date.now(),
    };
    db.prepare("INSERT INTO studios (id, user_id, name, created_at) VALUES (?, ?, ?, ?)").run(
      studio.id,
      studio.user_id,
      studio.name,
      studio.created_at
    );
    return { studio };
  });

  app.get("/api/studios/:studioId", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const { studioId } = req.params as { studioId: string };
    const studio = studioForUser(studioId, user.id);
    if (!studio) return reply.code(404).send({ error: "Studio not found" });
    const sessions = db
      .prepare("SELECT * FROM sessions WHERE studio_id = ? ORDER BY created_at DESC")
      .all(studioId);
    return { studio, sessions };
  });

  app.delete("/api/studios/:studioId", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const { studioId } = req.params as { studioId: string };
    const studio = studioForUser(studioId, user.id);
    if (!studio) return reply.code(404).send({ error: "Studio not found" });
    db.prepare("DELETE FROM studios WHERE id = ?").run(studioId);
    return { ok: true };
  });

  app.post("/api/studios/:studioId/sessions", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const { studioId } = req.params as { studioId: string };
    const studio = studioForUser(studioId, user.id);
    if (!studio) return reply.code(404).send({ error: "Studio not found" });
    const parsed = sessionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Session title is required" });

    const session: SessionRow = {
      id: newId(),
      studio_id: studioId,
      title: parsed.data.title,
      status: "created",
      invite_token: newToken(),
      created_at: Date.now(),
      ended_at: null,
    };
    db.prepare(
      `INSERT INTO sessions (id, studio_id, title, status, invite_token, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(session.id, session.studio_id, session.title, session.status, session.invite_token, session.created_at);
    return { session };
  });
}
