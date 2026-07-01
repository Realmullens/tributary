import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db, type SessionRow, type StudioRow, type UserRow } from "../lib/db.js";
import { newId, requireUser } from "../lib/auth.js";
import { newToken } from "../lib/ids.js";
import { sessionForMember, studioForMember, studioRole } from "../lib/access.js";

const nameSchema = z.object({ name: z.string().min(1).max(120) });
const sessionSchema = z.object({ title: z.string().min(1).max(200) });
const memberSchema = z.object({
  email: z.string().email(),
  role: z.enum(["owner", "editor"]).default("editor"),
});

/** @deprecated kept as the shared session-access check, now membership-based. */
export function sessionOwnedByUser(sessionId: string, userId: string): SessionRow | null {
  return sessionForMember(sessionId, userId);
}

export function registerStudioRoutes(app: FastifyInstance): void {
  app.get("/api/studios", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const studios = db
      .prepare(
        `SELECT s.*, m.role,
           (SELECT COUNT(*) FROM sessions WHERE studio_id = s.id) AS session_count,
           (SELECT COUNT(*) FROM studio_members WHERE studio_id = s.id) AS member_count
         FROM studios s JOIN studio_members m ON m.studio_id = s.id AND m.user_id = ?
         ORDER BY s.created_at DESC`
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
    db.prepare(
      "INSERT INTO studio_members (studio_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)"
    ).run(studio.id, user.id, Date.now());
    return { studio };
  });

  app.get("/api/studios/:studioId", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const { studioId } = req.params as { studioId: string };
    const studio = studioForMember(studioId, user.id);
    if (!studio) return reply.code(404).send({ error: "Studio not found" });
    const sessions = db
      .prepare("SELECT * FROM sessions WHERE studio_id = ? ORDER BY created_at DESC")
      .all(studioId);
    return { studio, sessions, role: studio.role };
  });

  app.delete("/api/studios/:studioId", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const { studioId } = req.params as { studioId: string };
    if (studioRole(studioId, user.id) !== "owner") {
      return reply.code(403).send({ error: "Only a studio owner can delete it" });
    }
    db.prepare("DELETE FROM studios WHERE id = ?").run(studioId);
    return { ok: true };
  });

  app.post("/api/studios/:studioId/sessions", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const { studioId } = req.params as { studioId: string };
    const studio = studioForMember(studioId, user.id);
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

  // ---- Members (owner-managed) ----
  app.get("/api/studios/:studioId/members", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const { studioId } = req.params as { studioId: string };
    if (!studioRole(studioId, user.id)) return reply.code(404).send({ error: "Studio not found" });
    const members = db
      .prepare(
        `SELECT u.id, u.name, u.email, m.role, m.created_at FROM studio_members m
         JOIN users u ON u.id = m.user_id WHERE m.studio_id = ? ORDER BY m.created_at ASC`
      )
      .all(studioId);
    return { members };
  });

  app.post("/api/studios/:studioId/members", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const { studioId } = req.params as { studioId: string };
    if (studioRole(studioId, user.id) !== "owner") {
      return reply.code(403).send({ error: "Only a studio owner can add members" });
    }
    const parsed = memberSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Valid email and role required" });
    const target = db
      .prepare("SELECT * FROM users WHERE email = ?")
      .get(parsed.data.email.toLowerCase()) as UserRow | undefined;
    if (!target) {
      return reply
        .code(404)
        .send({ error: "No account with that email — ask them to sign up first" });
    }
    db.prepare(
      `INSERT INTO studio_members (studio_id, user_id, role, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(studio_id, user_id) DO UPDATE SET role = excluded.role`
    ).run(studioId, target.id, parsed.data.role, Date.now());
    return { ok: true, member: { id: target.id, name: target.name, email: target.email, role: parsed.data.role } };
  });

  app.delete("/api/studios/:studioId/members/:userId", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const { studioId, userId } = req.params as { studioId: string; userId: string };
    if (studioRole(studioId, user.id) !== "owner") {
      return reply.code(403).send({ error: "Only a studio owner can remove members" });
    }
    const owners = db
      .prepare("SELECT COUNT(*) AS n FROM studio_members WHERE studio_id = ? AND role = 'owner'")
      .get(studioId) as { n: number };
    const targetRole = studioRole(studioId, userId);
    if (targetRole === "owner" && owners.n <= 1) {
      return reply.code(409).send({ error: "A studio must keep at least one owner" });
    }
    db.prepare("DELETE FROM studio_members WHERE studio_id = ? AND user_id = ?").run(studioId, userId);
    return { ok: true };
  });
}
