import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db, type UserRow } from "../lib/db.js";
import {
  createAuthToken,
  clearSessionCookie,
  deleteAuthToken,
  hashPassword,
  newId,
  requireUser,
  setSessionCookie,
  userFromRequest,
  verifyPassword,
} from "../lib/auth.js";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
});

const registerSchema = credentialsSchema.extend({
  name: z.string().min(1).max(100),
});

function publicUser(user: UserRow) {
  return { id: user.id, email: user.email, name: user.name };
}

export function registerAuthRoutes(app: FastifyInstance): void {
  app.post("/api/auth/register", async (req, reply) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid email, name, or password (min 8 chars)" });
    }
    const { email, name, password } = parsed.data;
    const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email.toLowerCase());
    if (existing) return reply.code(409).send({ error: "An account with that email already exists" });

    const user: UserRow = {
      id: newId(),
      email: email.toLowerCase(),
      name,
      password_hash: hashPassword(password),
      created_at: Date.now(),
    };
    db.prepare(
      "INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)"
    ).run(user.id, user.email, user.name, user.password_hash, user.created_at);

    setSessionCookie(reply, createAuthToken(user.id));
    return { user: publicUser(user) };
  });

  app.post("/api/auth/login", async (req, reply) => {
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid credentials" });
    const user = db
      .prepare("SELECT * FROM users WHERE email = ?")
      .get(parsed.data.email.toLowerCase()) as UserRow | undefined;
    if (!user || !verifyPassword(parsed.data.password, user.password_hash)) {
      return reply.code(401).send({ error: "Incorrect email or password" });
    }
    setSessionCookie(reply, createAuthToken(user.id));
    return { user: publicUser(user) };
  });

  app.post("/api/auth/logout", async (req, reply) => {
    deleteAuthToken(req);
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.get("/api/auth/me", async (req) => {
    const user = userFromRequest(req);
    return { user: user ? publicUser(user) : null };
  });

  // convenience: 401 helper used by client bootstrapping
  app.get("/api/auth/require", async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    return { user: publicUser(user) };
  });
}
