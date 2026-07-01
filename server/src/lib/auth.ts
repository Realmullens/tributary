import crypto from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { db, type ParticipantRow, type UserRow } from "./db.js";
import { newId, newToken } from "./ids.js";

const SESSION_COOKIE = "tributary_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return (
    candidate.length === expected.length &&
    crypto.timingSafeEqual(candidate, expected)
  );
}

export function createAuthToken(userId: string): string {
  const token = newToken();
  const now = Date.now();
  db.prepare(
    "INSERT INTO auth_tokens (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)"
  ).run(token, userId, now, now + SESSION_TTL_MS);
  return token;
}

export function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
}

export function userFromRequest(req: FastifyRequest): UserRow | null {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.* FROM auth_tokens t JOIN users u ON u.id = t.user_id
       WHERE t.token = ? AND t.expires_at > ?`
    )
    .get(token, Date.now()) as UserRow | undefined;
  return row ?? null;
}

export function requireUser(req: FastifyRequest, reply: FastifyReply): UserRow | null {
  const user = userFromRequest(req);
  if (!user) {
    reply.code(401).send({ error: "Not authenticated" });
    return null;
  }
  return user;
}

export function deleteAuthToken(req: FastifyRequest): void {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) db.prepare("DELETE FROM auth_tokens WHERE token = ?").run(token);
}

/** Resolve a participant from a bearer token (guests + hosts inside a room). */
export function participantFromRequest(req: FastifyRequest): ParticipantRow | null {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return null;
  return participantFromToken(token);
}

export function participantFromToken(token: string): ParticipantRow | null {
  const row = db
    .prepare("SELECT * FROM participants WHERE token = ?")
    .get(token) as ParticipantRow | undefined;
  return row ?? null;
}

export function requireParticipant(
  req: FastifyRequest,
  reply: FastifyReply
): ParticipantRow | null {
  const participant = participantFromRequest(req);
  if (!participant) {
    reply.code(401).send({ error: "Invalid participant token" });
    return null;
  }
  return participant;
}

export { newId };
