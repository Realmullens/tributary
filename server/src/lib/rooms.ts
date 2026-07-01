import type { WebSocket } from "ws";
import { db, type ParticipantRow, type RecordingRow } from "./db.js";

export type PeerState = { mic: boolean; cam: boolean; sharing: boolean };

export type UploadHealth = {
  state: string; // recording | uploading | caught_up | delayed | complete | failed
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
  const client: Client = {
    participantId: participant.id,
    sessionId: participant.session_id,
    role: participant.role,
    name: participant.name,
    socket,
    state: { mic: true, cam: true, sharing: false },
    upload: null,
  };
  r.set(participant.id, client);

  const rec = activeRecording(participant.session_id);
  send(client, {
    t: "welcome",
    self: publicPeer(client),
    peers: [...r.values()].filter((c) => c !== client).map(publicPeer),
    recording: rec ? { recordingId: rec.id, startedAtMs: rec.started_at_ms } : null,
  });
  broadcast(participant.session_id, { t: "peer-joined", peer: publicPeer(client) }, participant.id);

  db.prepare("UPDATE participants SET joined_at = COALESCE(joined_at, ?) WHERE id = ?").run(
    Date.now(),
    participant.id
  );
  return client;
}

export function removeClient(client: Client): void {
  const r = rooms.get(client.sessionId);
  if (!r) return;
  // Only remove if this socket is still the registered one (avoid nuking a reconnect).
  if (r.get(client.participantId)?.socket !== client.socket) return;
  r.delete(client.participantId);
  if (r.size === 0) rooms.delete(client.sessionId);
  broadcast(client.sessionId, { t: "peer-left", participantId: client.participantId });
  db.prepare("UPDATE participants SET left_at = ? WHERE id = ?").run(Date.now(), client.participantId);
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
    if (client.participantId !== exceptParticipantId) send(client, msg);
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
  switch (msg.t) {
    case "signal":
      // Relay WebRTC offers/answers/candidates verbatim.
      if (typeof msg.to === "string") {
        sendToPeer(client.sessionId, msg.to, {
          t: "signal",
          from: client.participantId,
          data: msg.data,
        });
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
    case "ping":
      // NTP-style: client sends its clock; server echoes both for offset estimation.
      send(client, { t: "pong", clientNow: msg.now, serverNow: Date.now() });
      break;
  }
}

export type { Client };
