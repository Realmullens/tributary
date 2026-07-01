import { db, type RecordingRow, type SessionRow } from "./db.js";
import { newId } from "./ids.js";
import { activeRecording, broadcast, roomComposition } from "./rooms.js";
import { checkRecordingComplete } from "../jobs/pipeline.js";

const pendingCountdowns = new Map<string, NodeJS.Timeout>();

export type StartResult =
  | { ok: true; countdownSeconds: number }
  | { ok: false; error: string };

/**
 * Begin recording for a session, optionally after a broadcast countdown.
 * The countdown runs server-side so every client sees the same authoritative timing.
 */
export function startRecording(sessionId: string, countdownSeconds: number): StartResult {
  if (activeRecording(sessionId)) return { ok: false, error: "Already recording" };
  if (pendingCountdowns.has(sessionId)) return { ok: false, error: "Countdown already running" };

  const seconds = Math.max(0, Math.min(10, Math.round(countdownSeconds)));
  if (seconds === 0) {
    beginNow(sessionId);
    return { ok: true, countdownSeconds: 0 };
  }

  broadcast(sessionId, { t: "recording-countdown", seconds, startsAtMs: Date.now() + seconds * 1000 });
  const timer = setTimeout(() => {
    pendingCountdowns.delete(sessionId);
    beginNow(sessionId);
  }, seconds * 1000);
  pendingCountdowns.set(sessionId, timer);
  return { ok: true, countdownSeconds: seconds };
}

function beginNow(sessionId: string): void {
  if (activeRecording(sessionId)) return;
  const recording: RecordingRow = {
    id: newId(),
    session_id: sessionId,
    started_at_ms: Date.now(),
    stopped_at_ms: null,
    status: "recording",
  };
  db.prepare("INSERT INTO recordings (id, session_id, started_at_ms, status) VALUES (?, ?, ?, ?)").run(
    recording.id,
    recording.session_id,
    recording.started_at_ms,
    recording.status
  );
  db.prepare("UPDATE sessions SET status = 'recording' WHERE id = ?").run(sessionId);
  broadcast(sessionId, {
    t: "recording-started",
    recordingId: recording.id,
    startedAtMs: recording.started_at_ms,
  });
}

export function stopRecording(sessionId: string): { ok: boolean; error?: string } {
  // Cancel a pending countdown if the host aborts before it fires.
  const pending = pendingCountdowns.get(sessionId);
  if (pending) {
    clearTimeout(pending);
    pendingCountdowns.delete(sessionId);
    broadcast(sessionId, { t: "recording-countdown-cancelled" });
    return { ok: true };
  }

  const recording = activeRecording(sessionId);
  if (!recording) return { ok: false, error: "Not recording" };

  const stoppedAtMs = Date.now();
  db.prepare("UPDATE recordings SET stopped_at_ms = ?, status = 'uploading' WHERE id = ?").run(
    stoppedAtMs,
    recording.id
  );
  db.prepare("UPDATE sessions SET status = 'live' WHERE id = ?").run(sessionId);
  broadcast(sessionId, { t: "recording-stopped", recordingId: recording.id, stoppedAtMs });
  // In case no client ever created a track (e.g. record with zero devices), settle state.
  setTimeout(() => checkRecordingComplete(recording.id), 5000);
  return { ok: true };
}

/** Auto-record: start (with countdown) when the first guest joins, if enabled. */
export function maybeAutoRecord(sessionId: string): void {
  const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId) as
    | (SessionRow & { auto_record: number })
    | undefined;
  if (!session?.auto_record) return;
  if (activeRecording(sessionId) || pendingCountdowns.has(sessionId)) return;
  const { hosts, guests } = roomComposition(sessionId);
  if (hosts > 0 && guests > 0) {
    startRecording(sessionId, 3);
  }
}
