import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./storage.js";

fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(path.join(DATA_DIR, "tributary.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_tokens (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS studios (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  studio_id TEXT NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'created', -- created | live | recording | ended
  invite_token TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  ended_at INTEGER
);

CREATE TABLE IF NOT EXISTS participants (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'guest', -- host | guest
  token TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  joined_at INTEGER,
  left_at INTEGER
);

CREATE TABLE IF NOT EXISTS recordings (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  started_at_ms INTEGER NOT NULL,
  stopped_at_ms INTEGER,
  status TEXT NOT NULL DEFAULT 'recording' -- recording | uploading | processing | ready | failed
);

CREATE TABLE IF NOT EXISTS tracks (
  id TEXT PRIMARY KEY,
  recording_id TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  type TEXT NOT NULL, -- camera | screen
  mime_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'recording', -- recording | uploading | uploaded | processing | ready | failed
  start_offset_ms INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  final_chunk_count INTEGER, -- set at finalize; NULL while recording
  width INTEGER,
  height INTEGER,
  error TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chunks (
  track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  size_bytes INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  PRIMARY KEY (track_id, idx)
);

CREATE TABLE IF NOT EXISTS exports (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  recording_id TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  type TEXT NOT NULL, -- mixed_video | mixed_audio
  status TEXT NOT NULL DEFAULT 'queued', -- queued | processing | ready | failed
  format TEXT NOT NULL,
  size_bytes INTEGER,
  duration_ms INTEGER,
  error TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_studio ON sessions(studio_id);
`);

// Additive migrations for databases created before these columns existed.
for (const migration of [
  "ALTER TABLE sessions ADD COLUMN auto_record INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE sessions ADD COLUMN waiting_room INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE sessions ADD COLUMN teleprompter_script TEXT",
  "ALTER TABLE participants ADD COLUMN admitted_at INTEGER",
  "ALTER TABLE exports ADD COLUMN params_json TEXT",
  "ALTER TABLE transcripts ADD COLUMN words_json TEXT",
  "ALTER TABLE sessions ADD COLUMN watch_token TEXT",
  "ALTER TABLE tracks ADD COLUMN enhanced INTEGER NOT NULL DEFAULT 0",
]) {
  try {
    db.exec(migration);
  } catch {
    // column already exists
  }
}


db.exec(`
CREATE INDEX IF NOT EXISTS idx_participants_session ON participants(session_id);
CREATE INDEX IF NOT EXISTS idx_tracks_recording ON tracks(recording_id);
CREATE INDEX IF NOT EXISTS idx_recordings_session ON recordings(session_id);

CREATE TABLE IF NOT EXISTS studio_members (
  studio_id TEXT NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'editor', -- owner | editor
  created_at INTEGER NOT NULL,
  PRIMARY KEY (studio_id, user_id)
);

CREATE TABLE IF NOT EXISTS transcripts (
  id TEXT PRIMARY KEY,
  recording_id TEXT NOT NULL UNIQUE REFERENCES recordings(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued', -- queued | processing | ready | failed
  language TEXT,
  provider TEXT NOT NULL DEFAULT 'whisper.cpp',
  segments_json TEXT,
  error TEXT,
  created_at INTEGER NOT NULL
);
`);

// Backfill: every studio's creator is an owner member (idempotent).
db.exec(`
  INSERT OR IGNORE INTO studio_members (studio_id, user_id, role, created_at)
  SELECT id, user_id, 'owner', created_at FROM studios
`);

export type UserRow = {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  created_at: number;
};

export type StudioRow = {
  id: string;
  user_id: string;
  name: string;
  created_at: number;
};

export type SessionRow = {
  id: string;
  studio_id: string;
  title: string;
  status: string;
  invite_token: string;
  created_at: number;
  ended_at: number | null;
  auto_record?: number;
  waiting_room?: number;
  teleprompter_script?: string | null;
};

export type ParticipantRow = {
  id: string;
  session_id: string;
  user_id: string | null;
  name: string;
  role: "host" | "guest";
  token: string;
  created_at: number;
  joined_at: number | null;
  left_at: number | null;
  admitted_at?: number | null;
};

export type RecordingRow = {
  id: string;
  session_id: string;
  started_at_ms: number;
  stopped_at_ms: number | null;
  status: string;
};

export type TrackRow = {
  id: string;
  recording_id: string;
  session_id: string;
  participant_id: string;
  type: "camera" | "screen" | "pcm";
  mime_type: string;
  status: string;
  start_offset_ms: number;
  duration_ms: number | null;
  size_bytes: number;
  final_chunk_count: number | null;
  width: number | null;
  height: number | null;
  error: string | null;
  created_at: number;
  enhanced?: number;
};

export type TranscriptSegment = {
  startMs: number;
  endMs: number;
  text: string;
  speaker: string;
  trackId: string;
};

export type TranscriptWord = {
  startMs: number;
  endMs: number;
  text: string;
  speaker: string;
  trackId: string;
};

export type TranscriptRow = {
  id: string;
  recording_id: string;
  session_id: string;
  status: string;
  language: string | null;
  provider: string;
  segments_json: string | null;
  words_json?: string | null;
  error: string | null;
  created_at: number;
};

export type ExportParams = {
  trimStartMs?: number;
  trimEndMs?: number;
  /** Ranges (ms, timeline time) removed from the middle of the recording. */
  cuts?: { startMs: number; endMs: number }[];
  /** Output canvas: "16:9" (default), "1:1", or "9:16" for social clips. */
  aspect?: string;
  /** Generate captions (SRT sidecar; burned in when ffmpeg supports libass). */
  captions?: boolean;
};

export type ExportRow = {
  id: string;
  session_id: string;
  recording_id: string;
  type: "mixed_video" | "mixed_audio";
  status: string;
  format: string;
  size_bytes: number | null;
  duration_ms: number | null;
  error: string | null;
  created_at: number;
  params_json?: string | null;
};
