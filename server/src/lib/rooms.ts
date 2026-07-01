import type { WebSocket } from "ws";
import { db, type ParticipantRow, type RecordingRow, type SessionRow } from "./db.js";
import { maybeAutoRecord, stopRecording } from "./recording.js";

/** How many participants can be in the live room at once (Riverside parity). */
export const MAX_ROOM_PARTICIPANTS = 10;

// Zombie-recording protection: if everyone leaves mid-recording, stop it
// after a grace period so a forgotten session doesn't record forever.
const emptyRoomTimers = new Map<string, NodeJS.Timeout>();

function scheduleEmptyRoomStop(sessionId: string): void {
  if (emptyRoomTimers.has(sessionId)) return;
  emptyRoomTimers.set(
    sessionId,
    setTimeout(() => {
      emptyRoomTimers.delete(sessionId);
      const stillEmpty = (rooms.get(sessionId)?.size ?? 0) === 0;
      if (stillEmpty && activeRecording(sessionId)) {
        console.warn(`[rooms] stopping abandoned recording in session ${sessionId}`);
        stopRecording(sessionId);
      }
    }, 60_000)
  );
}

function cancelEmptyRoomStop(sessionId: string): void {
  const timer = emptyRoomTimers.get(sessionId);
  if (timer) clearTimeout(timer);
  emptyRoomTimers.delete(sessionId);
}

export type PeerState = { mic: boolean; cam: boolean; sharing: boolean };

export type UploadHealth = {
  state: string; // recording | uploading | caught_up | delayed | paused | complete | failed
  queuedChunks: number;
  uploadedBytes: number;
  totalBytes: number;
  percent: number;
};

type Client = {
  participantId: string;
  sessionId: string;
  role: "host" | "guest";
  name: string;
  socket: WebSocket;
  state: PeerState;
  upload: UploadHealth | null;
  /** In the waiting room: invisible to the call until a host admits them. */
  waiting: boolean;
};

const rooms = new Map<string, Map<string, Client>>();

function room(sessionId: string): Map<string, Client> {
  let r = rooms.get(sessionId);
  if (!r) {
    r = new Map();
    rooms.set(sessionId, r);
  }
  return r;
}

export function publicPeer(c: Client) {
  return {
    participantId: c.participantId,
    name: c.name,
    role: c.role,
    state: c.state,
    upload: c.upload,
  };
}

export function activeRecording(sessionId: string): RecordingRow | null {
  const row = db
    .prepare("SELECT * FROM recordings WHERE session_id = ? AND status = 'recording' ORDER BY started_at_ms DESC")
    .get(sessionId) as RecordingRow | undefined;
  return row ?? null;
}

export function addClient(participant: ParticipantRow, socket: WebSocket): Client {
  const r = room(participant.session_id);
  // Replace any stale connection from the same participant (refresh, reconnect).
  const stale = r.get(participant.id);
  if (stale && stale.socket !== socket) {
    try {
      stale.socket.close(4000, "replaced");
    } catch {
      /* already closed */
    }
  }

  const session = db
    .prepare("SELECT * FROM sessions WHERE id = ?")
    .get(participant.session_id) as SessionRow | undefined;
  const fresh = db
    .prepare("SELECT admitted_at FROM participants WHERE id = ?")
    .get(participant.id) as { admitted_at: number | null } | undefined;
  const needsAdmission =
    participant.role === "guest" && Boolean(session?.waiting_room) && !fresh?.admitted_at;

  const client: Client = {
    participantId: participant.id,
    sessionId: participant.session_id,
    role: participant.role,
    name: participant.name,
    socket,
    state: { mic: true, cam: true, sharing: false },
    upload: null,
    waiting: needsAdmission,
  };
  r.set(participant.id, client);
  cancelEmptyRoomStop(participant.session_id);

  if (client.waiting) {
    send(client, { t: "waiting-room" });
    notifyHosts(client.sessionId, { t: "waiting-guest", peer: publicPeer(client) });
  } else {
    admitToRoom(client);
  }
  return client;
}

/** Send the welcome payload and make the client visible to the call. */
function admitToRoom(client: Client): void {
  const r = rooms.get(client.sessionId);
  const rec = activeRecording(client.sessionId);
  const session = db
    .prepare("SELECT teleprompter_script FROM sessions WHERE id = ?")
    .get(client.sessionId) as { teleprompter_script: string | null } | undefined;

  send(client, {
    t: "welcome",
    self: publicPeer(client),
    peers: [...(r?.values() ?? [])]
      .filter((c) => c !== client && !c.waiting)
      .map(publicPeer),
    recording: rec ? { recordingId: rec.id, startedAtMs: rec.started_at_ms } : null,
    teleprompter: session?.teleprompter_script ?? null,
    waiting:
      client.role === "host"
        ? [...(r?.values() ?? [])].filter((c) => c.waiting).map(publicPeer)
        : undefined,
  });
  broadcast(client.sessionId, { t: "peer-joined", peer: publicPeer(client) }, client.participantId);

  db.prepare("UPDATE participants SET joined_at = COALESCE(joined_at, ?) WHERE id = ?").run(
    Date.now(),
    client.participantId
  );
  maybeAutoRecord(client.sessionId);
}

export function removeClient(client: Client): void {
  const r = rooms.get(client.sessionId);
  if (!r) return;
  // Only remove if this socket is still the registered one (avoid nuking a reconnect).
  if (r.get(client.participantId)?.socket !== client.socket) return;
  r.delete(client.participantId);
  if (r.size === 0) {
    rooms.delete(client.sessionId);
    if (activeRecording(client.sessionId)) scheduleEmptyRoomStop(client.sessionId);
  }
  if (client.waiting) {
    notifyHosts(client.sessionId, { t: "waiting-left", participantId: client.participantId });
  } else {
    broadcast(client.sessionId, { t: "peer-left", participantId: client.participantId });
  }
  db.prepare("UPDATE participants SET left_at = ? WHERE id = ?").run(Date.now(), client.participantId);
}

/** Total connected clients (including waiting) — used for the room cap. */
export function roomSize(sessionId: string): number {
  return rooms.get(sessionId)?.size ?? 0;
}

/** How many hosts/guests are currently in the call (waiting-room guests excluded). */
export function roomComposition(sessionId: string): { hosts: number; guests: number } {
  const r = rooms.get(sessionId);
  let hosts = 0;
  let guests = 0;
  for (const client of r?.values() ?? []) {
    if (client.waiting) continue;
    if (client.role === "host") hosts++;
    else guests++;
  }
  return { hosts, guests };
}

function send(client: Client, msg: unknown): void {
  if (client.socket.readyState === 1) {
    client.socket.send(JSON.stringify(msg));
  }
}

export function broadcast(sessionId: string, msg: unknown, exceptParticipantId?: string): void {
  const r = rooms.get(sessionId);
  if (!r) return;
  for (const client of r.values()) {
    if (client.waiting) continue;
    if (client.participantId !== exceptParticipantId) send(client, msg);
  }
}

function notifyHosts(sessionId: string, msg: unknown): void {
  const r = rooms.get(sessionId);
  if (!r) return;
  for (const client of r.values()) {
    if (client.role === "host" && !client.waiting) send(client, msg);
  }
}

export function sendToPeer(sessionId: string, participantId: string, msg: unknown): void {
  const client = rooms.get(sessionId)?.get(participantId);
  if (client) send(client, msg);
}

export function handleClientMessage(client: Client, raw: string): void {
  let msg: any;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }

  // Waiting-room guests can only keep the clock sync alive.
  if (client.waiting && msg.t !== "ping") return;

  switch (msg.t) {
    case "signal":
      // Relay WebRTC offers/answers/candidates verbatim.
      if (typeof msg.to === "string") {
        const target = rooms.get(client.sessionId)?.get(msg.to);
        if (target && !target.waiting) {
          send(target, { t: "signal", from: client.participantId, data: msg.data });
        }
      }
      break;
    case "state":
      client.state = {
        mic: Boolean(msg.mic),
        cam: Boolean(msg.cam),
        sharing: Boolean(msg.sharing),
      };
      broadcast(
        client.sessionId,
        { t: "state", participantId: client.participantId, state: client.state },
        client.participantId
      );
      break;
    case "chat": {
      const text = String(msg.text ?? "").slice(0, 2000).trim();
      if (!text) return;
      broadcast(client.sessionId, {
        t: "chat",
        from: client.participantId,
        name: client.name,
        text,
        at: Date.now(),
      });
      break;
    }
    case "upload":
      client.upload = msg.health ?? null;
      broadcast(
        client.sessionId,
        { t: "upload", participantId: client.participantId, health: client.upload },
        client.participantId
      );
      break;
    case "admit": {
      if (client.role !== "host") return;
      const target = rooms.get(client.sessionId)?.get(String(msg.participantId));
      if (!target?.waiting) return;
      db.prepare("UPDATE participants SET admitted_at = ? WHERE id = ?").run(
        Date.now(),
        target.participantId
      );
      target.waiting = false;
      notifyHosts(client.sessionId, { t: "waiting-left", participantId: target.participantId });
      admitToRoom(target);
      break;
    }
    case "decline": {
      if (client.role !== "host") return;
      const target = rooms.get(client.sessionId)?.get(String(msg.participantId));
      if (!target?.waiting) return;
      send(target, { t: "declined" });
      try {
        target.socket.close(4403, "declined");
      } catch {
        /* already closed */
      }
      // removeClient runs via the socket close handler and notifies hosts.
      break;
    }
    case "force-mute":
      if (client.role !== "host") return;
      sendToPeer(client.sessionId, String(msg.participantId), { t: "force-mute" });
      break;
    case "teleprompter-set": {
      if (client.role !== "host") return;
      const script = String(msg.script ?? "").slice(0, 50_000);
      db.prepare("UPDATE sessions SET teleprompter_script = ? WHERE id = ?").run(
        script,
        client.sessionId
      );
      broadcast(client.sessionId, { t: "teleprompter", script }, client.participantId);
      break;
    }
    case "ping":
      // NTP-style: client sends its clock; server echoes both for offset estimation.
      send(client, { t: "pong", clientNow: msg.now, serverNow: Date.now() });
      break;
  }
}

export type { Client };
