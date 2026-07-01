#!/usr/bin/env node
/**
 * tributary — CLI for the Tributary recording studio, built for AI agents.
 *
 * Every command prints JSON to stdout (errors as JSON to stderr, exit 1),
 * so any agent — Claude Code, Codex, a script — can drive the full
 * post-production workflow: read transcripts, decide cuts, render clips.
 *
 * See docs/AI-AGENTS.md for the agent workflow guide.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CONFIG_PATH = path.join(os.homedir(), ".tributary.json");

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return {};
  }
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
}

function fail(message) {
  console.error(JSON.stringify({ error: message }));
  process.exit(1);
}

function out(value) {
  console.log(JSON.stringify(value, null, 2));
}

// ---- arg parsing: positionals + --flag value + --bool ----
const [, , command, ...rest] = process.argv;
const args = [];
const flags = {};
for (let i = 0; i < rest.length; i++) {
  const a = rest[i];
  if (a.startsWith("-") && a !== "-") {
    const key = a.replace(/^-+/, "");
    const next = rest[i + 1];
    if (next !== undefined && !(next.startsWith("-") && next !== "-" && isNaN(Number(next)))) {
      // repeatable flags (e.g. --cut) accumulate into arrays
      if (flags[key] !== undefined) {
        flags[key] = Array.isArray(flags[key]) ? [...flags[key], next] : [flags[key], next];
      } else {
        flags[key] = next;
      }
      i++;
    } else {
      flags[key] = true;
    }
  } else {
    args.push(a);
  }
}

const config = loadConfig();
const server = flags.server ?? process.env.TRIBUTARY_SERVER ?? config.server ?? "http://localhost:4100";
const token = flags.token ?? process.env.TRIBUTARY_TOKEN ?? config.token;

async function api(pathname, { method = "GET", body } = {}) {
  const res = await fetch(`${server}${pathname}`, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }).catch((err) => fail(`Cannot reach ${server}: ${err.message}`));
  const data = await res.json().catch(() => ({}));
  if (!res.ok) fail(data.error ?? `${method} ${pathname} → HTTP ${res.status}`);
  return data;
}

async function downloadTo(pathname, outFile) {
  const res = await fetch(`${server}${pathname}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    fail(data.error ?? `download → HTTP ${res.status}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(outFile, buffer);
  return { file: path.resolve(outFile), bytes: buffer.length };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findRecordingSession(recordingId) {
  const data = await api(`/api/recordings/${recordingId}`);
  return data.recording.session_id;
}

async function waitForExport(sessionId, exportId, timeoutSec = 600) {
  for (let i = 0; i < timeoutSec / 2; i++) {
    const detail = await api(`/api/sessions/${sessionId}`);
    const exp = detail.exports.find((e) => e.id === exportId);
    if (exp?.status === "ready") return exp;
    if (exp?.status === "failed") fail(`export failed: ${exp.error}`);
    await sleep(2000);
  }
  fail("timed out waiting for export");
}

const HELP = {
  usage: "tributary <command> [args] [--flags]",
  commands: {
    "login --email E --password P [--server URL]": "authenticate; saves token to ~/.tributary.json",
    whoami: "show the signed-in user",
    studios: "list studios",
    "sessions <studioId>": "list sessions in a studio",
    "session <sessionId>": "full detail: recordings, tracks, exports, transcripts",
    "transcribe <recordingId> [--wait]": "run whisper transcription",
    "transcript <recordingId> [--format json|txt|srt|vtt] [-o file]": "get the transcript",
    "words <recordingId>": "word-level timestamps (for text-based editing decisions)",
    "export <recordingId> [--audio] [--trim-start MS] [--trim-end MS] [--cut START-END ...] [--aspect 16:9|1:1|9:16] [--captions] [--wait] [-o file]":
      "render a mixed export / clip; --cut is repeatable, times in ms on the recording timeline",
    "download-track <trackId> [--kind mp4|wav|raw|enhanced] -o file": "download a participant track",
    "enhance <trackId>": "noise reduction + loudness normalization; later mixes prefer the enhanced audio",
    "download-export <exportId> -o file [--srt captions.srt]": "download a finished export (+ caption sidecar)",
    "xml <recordingId> -o file": "Premiere/FCP XML timeline for the recording",
  },
  notes: [
    "All output is JSON. Times are milliseconds on the recording timeline (same timebase as transcript/words).",
    "Set TRIBUTARY_SERVER / TRIBUTARY_TOKEN env vars to override ~/.tributary.json.",
  ],
};

const commands = {
  async help() {
    out(HELP);
  },

  async login() {
    const email = flags.email;
    const password = flags.password ?? process.env.TRIBUTARY_PASSWORD;
    if (!email || !password) fail("login needs --email and --password (or TRIBUTARY_PASSWORD)");
    const res = await fetch(`${server}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) fail(data.error ?? `login failed (HTTP ${res.status})`);
    saveConfig({ server, token: data.token });
    out({ ok: true, user: data.user, config: CONFIG_PATH });
  },

  async whoami() {
    out(await api("/api/auth/me"));
  },

  async studios() {
    out(await api("/api/studios"));
  },

  async sessions() {
    const [studioId] = args;
    if (!studioId) fail("usage: tributary sessions <studioId>");
    const data = await api(`/api/studios/${studioId}`);
    out({ studio: data.studio, sessions: data.sessions });
  },

  async session() {
    const [sessionId] = args;
    if (!sessionId) fail("usage: tributary session <sessionId>");
    out(await api(`/api/sessions/${sessionId}`));
  },

  async transcribe() {
    const [recordingId] = args;
    if (!recordingId) fail("usage: tributary transcribe <recordingId> [--wait]");
    await api(`/api/recordings/${recordingId}/transcribe`, { method: "POST", body: {} });
    if (!flags.wait) return out({ ok: true, status: "queued" });
    for (let i = 0; i < 300; i++) {
      const data = await api(`/api/recordings/${recordingId}/transcript`).catch(() => null);
      if (data?.transcript?.status === "ready") return out({ ok: true, status: "ready" });
      if (data?.transcript?.status === "failed") fail(`transcription failed: ${data.transcript.error}`);
      await sleep(2000);
    }
    fail("timed out waiting for transcription");
  },

  async transcript() {
    const [recordingId] = args;
    if (!recordingId) fail("usage: tributary transcript <recordingId> [--format json|txt|srt|vtt]");
    const format = flags.format ?? "json";
    if (format === "json") {
      return out(await api(`/api/recordings/${recordingId}/transcript`));
    }
    const target = flags.o ?? `transcript-${recordingId.slice(0, 6)}.${format}`;
    out(await downloadTo(`/api/recordings/${recordingId}/transcript/download?format=${format}`, target));
  },

  async words() {
    const [recordingId] = args;
    if (!recordingId) fail("usage: tributary words <recordingId>");
    const data = await api(`/api/recordings/${recordingId}`);
    if (!data.transcriptWords) fail("no word-level transcript yet — run: tributary transcribe " + recordingId + " --wait");
    out({ words: data.transcriptWords });
  },

  async export() {
    const [recordingId] = args;
    if (!recordingId) fail("usage: tributary export <recordingId> [options] (see: tributary help)");
    const cutsRaw = flags.cut === undefined ? [] : Array.isArray(flags.cut) ? flags.cut : [flags.cut];
    const cuts = cutsRaw.map((c) => {
      const m = String(c).match(/^(\d+)-(\d+)$/);
      if (!m) fail(`--cut expects START-END in ms, got: ${c}`);
      return { startMs: Number(m[1]), endMs: Number(m[2]) };
    });
    const body = {
      type: flags.audio ? "mixed_audio" : "mixed_video",
      trimStartMs: flags["trim-start"] !== undefined ? Number(flags["trim-start"]) : undefined,
      trimEndMs: flags["trim-end"] !== undefined ? Number(flags["trim-end"]) : undefined,
      cuts,
      aspect: flags.aspect,
      captions: flags.captions === true || undefined,
    };
    const { export: exp } = await api(`/api/recordings/${recordingId}/exports`, { method: "POST", body });
    if (!flags.wait && !flags.o) return out({ ok: true, exportId: exp.id, status: exp.status });

    const sessionId = await findRecordingSession(recordingId);
    const ready = await waitForExport(sessionId, exp.id);
    const result = { ok: true, exportId: exp.id, durationMs: ready.duration_ms, sizeBytes: ready.size_bytes };
    if (flags.o) {
      result.download = await downloadTo(`/api/exports/${exp.id}/download`, flags.o);
      if (ready.has_captions) {
        const srtPath = flags.o.replace(/\.[^.]+$/, "") + ".srt";
        result.captions = await downloadTo(`/api/exports/${exp.id}/captions`, srtPath);
      }
    }
    out(result);
  },

  async enhance() {
    const [trackId] = args;
    if (!trackId) fail("usage: tributary enhance <trackId>");
    await api(`/api/tracks/${trackId}/enhance`, { method: "POST", body: {} });
    out({ ok: true, status: "queued" });
  },

  async "download-track"() {
    const [trackId] = args;
    if (!trackId || !flags.o) fail("usage: tributary download-track <trackId> [--kind mp4|wav|raw] -o file");
    out(await downloadTo(`/api/tracks/${trackId}/download?kind=${flags.kind ?? "mp4"}`, flags.o));
  },

  async "download-export"() {
    const [exportId] = args;
    if (!exportId || !flags.o) fail("usage: tributary download-export <exportId> -o file [--srt captions.srt]");
    const result = { download: await downloadTo(`/api/exports/${exportId}/download`, flags.o) };
    if (flags.srt) result.captions = await downloadTo(`/api/exports/${exportId}/captions`, flags.srt);
    out(result);
  },

  async xml() {
    const [recordingId] = args;
    if (!recordingId) fail("usage: tributary xml <recordingId> -o file");
    const target = flags.o ?? `timeline-${recordingId.slice(0, 6)}.xml`;
    out(await downloadTo(`/api/recordings/${recordingId}/xml`, target));
  },
};

const handler = commands[command ?? "help"];
if (!handler) fail(`unknown command: ${command} — run: tributary help`);
await handler();
