import { db, type SessionRow, type StudioRow } from "./db.js";

export type StudioRole = "owner" | "editor";

/** The caller's role in a studio, or null if they're not a member. */
export function studioRole(studioId: string, userId: string): StudioRole | null {
  const row = db
    .prepare("SELECT role FROM studio_members WHERE studio_id = ? AND user_id = ?")
    .get(studioId, userId) as { role: StudioRole } | undefined;
  return row?.role ?? null;
}

export function studioForMember(studioId: string, userId: string): (StudioRow & { role: StudioRole }) | null {
  const row = db
    .prepare(
      `SELECT s.*, m.role FROM studios s
       JOIN studio_members m ON m.studio_id = s.id AND m.user_id = ?
       WHERE s.id = ?`
    )
    .get(userId, studioId) as (StudioRow & { role: StudioRole }) | undefined;
  return row ?? null;
}

export function sessionForMember(sessionId: string, userId: string): SessionRow | null {
  const row = db
    .prepare(
      `SELECT s.* FROM sessions s
       JOIN studio_members m ON m.studio_id = s.studio_id AND m.user_id = ?
       WHERE s.id = ?`
    )
    .get(userId, sessionId) as SessionRow | undefined;
  return row ?? null;
}

/** Reusable SQL fragment: rows reachable through the caller's memberships. */
export const MEMBER_JOIN = `JOIN studio_members mem ON mem.studio_id = st.id AND mem.user_id = ?`;
