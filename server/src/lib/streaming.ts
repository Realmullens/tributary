import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { db } from "./db.js";
import { newToken } from "./ids.js";
import { DATA_DIR } from "./storage.js";
import { broadcast } from "./rooms.js";

const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";

export const LIVE_DIR = path.join(DATA_DIR, "live");
fs.mkdirSync(LIVE_DIR, { recursive: true });

// Startup sweep: HLS dirs from previous runs are dead weight.
for (const entry of fs.readdirSync(LIVE_DIR)) {
  fs.rmSync(path.join(LIVE_DIR, entry), { recursive: true, force: true });
}

type ActiveStream = {
  sessionId: string;
  process: ChildProcess;
  startedAt: number;
  rtmpUrl: string | null;
  hlsDir: string;
};

const activeStreams = new Map<string, ActiveStream>();

export function streamStatus(sessionId: string): { live: boolean; startedAt?: number; rtmp?: boolean } {
  const s = activeStreams.get(sessionId);
  return s ? { live: true, startedAt: s.startedAt, rtmp: Boolean(s.rtmpUrl) } : { live: false };
}

/** Ensure the session has a public watch token; returns it. */
export function ensureWatchToken(sessionId: string): string {
  const row = db.prepare("SELECT watch_token FROM sessions WHERE id = ?").get(sessionId) as
    | { watch_token: string | null }
    | undefined;
  if (row?.watch_token) return row.watch_token;
  const token = newToken();
  db.prepare("UPDATE sessions SET watch_token = ? WHERE id = ?").run(token, sessionId);
  return token;
}

export function sessionForWatchToken(token: string): { id: string; title: string } | null {
  const row = db
    .prepare("SELECT id, title FROM sessions WHERE watch_token = ?")
    .get(token) as { id: string; title: string } | undefined;
  return row ?? null;
}

export function hlsDirFor(sessionId: string): string {
  return path.join(LIVE_DIR, sessionId);
}

/**
 * Start the live pipeline: the host's browser sends a composited WebM stream
 * (canvas + mixed audio via MediaRecorder) which ffmpeg fans out to HLS
 * (for the public watch page) and optionally an RTMP destination.
 */
export function startStream(sessionId: string, rtmpUrl: string | null): ActiveStream {
  stopStream(sessionId); // replace any stale pipeline

  const hlsDir = hlsDirFor(sessionId);
  fs.rmSync(hlsDir, { recursive: true, force: true });
  fs.mkdirSync(hlsDir, { recursive: true });

  const args = [
    "-hide_banner",
    "-loglevel", "warning",
    "-f", "webm",
    "-i", "pipe:0",
    // HLS out (always) — feeds the watch page
    "-c:v", "libx264", "-preset", "veryfast", "-tune", "zerolatency",
    "-pix_fmt", "yuv420p", "-g", "60",
    "-c:a", "aac", "-b:a", "128k", "-ar", "48000",
    "-f", "hls",
    "-hls_time", "2",
    "-hls_list_size", "6",
    "-hls_flags", "delete_segments+independent_segments",
    path.join(hlsDir, "index.m3u8"),
  ];
  if (rtmpUrl) {
    args.push(
      "-c:v", "libx264", "-preset", "veryfast", "-tune", "zerolatency",
      "-pix_fmt", "yuv420p", "-g", "60",
      "-c:a", "aac", "-b:a", "128k", "-ar", "44100",
      "-f", "flv",
      rtmpUrl
    );
  }

  const child = spawn(FFMPEG, args, { stdio: ["pipe", "ignore", "pipe"] });
  let stderrTail = "";
  child.stderr?.on("data", (d: Buffer) => {
    stderrTail = (stderrTail + d.toString()).slice(-2000);
  });
  child.on("exit", (code) => {
    if (activeStreams.get(sessionId)?.process === child) {
      activeStreams.delete(sessionId);
      broadcast(sessionId, { t: "live-stopped" });
      if (code && code !== 0 && code !== 255) {
        console.error(`[stream] ffmpeg for ${sessionId} exited ${code}: ${stderrTail}`);
      }
    }
  });

  const stream: ActiveStream = {
    sessionId,
    process: child,
    startedAt: Date.now(),
    rtmpUrl,
    hlsDir,
  };
  activeStreams.set(sessionId, stream);
  ensureWatchToken(sessionId);
  broadcast(sessionId, { t: "live-started", startedAt: stream.startedAt });
  return stream;
}

export function writeStreamChunk(sessionId: string, chunk: Buffer): void {
  const s = activeStreams.get(sessionId);
  s?.process.stdin?.write(chunk);
}

export function stopStream(sessionId: string): void {
  const s = activeStreams.get(sessionId);
  if (!s) return;
  activeStreams.delete(sessionId);
  try {
    s.process.stdin?.end();
  } catch {
    /* already gone */
  }
  // give ffmpeg a moment to flush the playlist, then make sure it's gone
  setTimeout(() => {
    if (s.process.exitCode === null) s.process.kill("SIGKILL");
  }, 3000);
  broadcast(sessionId, { t: "live-stopped" });
}
