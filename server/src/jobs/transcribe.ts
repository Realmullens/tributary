import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline as streamPipeline } from "node:stream/promises";
import {
  db,
  type TranscriptRow,
  type TranscriptSegment,
  type TranscriptWord,
  type TrackRow,
} from "../lib/db.js";
import { newId } from "../lib/ids.js";
import { DATA_DIR, wavTrackPath } from "../lib/storage.js";
import { broadcast } from "../lib/rooms.js";
import { enqueue } from "./pipeline.js";

const WHISPER_CLI = process.env.WHISPER_CLI ?? "whisper-cli";
const MODEL_PATH =
  process.env.WHISPER_MODEL ?? path.join(DATA_DIR, "models", "ggml-base.bin");
const MODEL_URL =
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin";

function run(bin: string, args: string[], timeoutMs = 60 * 60 * 1000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 256 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${bin} failed: ${stderr?.slice(-2000) || err.message}`));
      else resolve(stdout);
    });
  });
}

let modelDownload: Promise<void> | null = null;

/** Download the whisper model on first use (~148MB, one-time). */
async function ensureModel(): Promise<void> {
  if (fs.existsSync(MODEL_PATH)) return;
  modelDownload ??= (async () => {
    console.log(`[transcribe] downloading whisper model to ${MODEL_PATH} (~148MB, one-time)…`);
    fs.mkdirSync(path.dirname(MODEL_PATH), { recursive: true });
    const res = await fetch(MODEL_URL);
    if (!res.ok || !res.body) throw new Error(`model download failed: HTTP ${res.status}`);
    const tmp = `${MODEL_PATH}.download`;
    await streamPipeline(Readable.fromWeb(res.body as any), fs.createWriteStream(tmp));
    fs.renameSync(tmp, MODEL_PATH);
    console.log("[transcribe] model ready");
  })().catch((err) => {
    modelDownload = null; // allow retry on next request
    throw err;
  });
  await modelDownload;
}

export function queueTranscription(recordingId: string, sessionId: string): TranscriptRow {
  // One transcript per take; re-transcribing replaces the previous run.
  db.prepare("DELETE FROM transcripts WHERE recording_id = ?").run(recordingId);
  const row: TranscriptRow = {
    id: newId(),
    recording_id: recordingId,
    session_id: sessionId,
    status: "queued",
    language: null,
    provider: "whisper.cpp",
    segments_json: null,
    error: null,
    created_at: Date.now(),
  };
  db.prepare(
    `INSERT INTO transcripts (id, recording_id, session_id, status, provider, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(row.id, row.recording_id, row.session_id, row.status, row.provider, row.created_at);
  enqueue(() => transcribeRecording(row.id));
  return row;
}

async function transcribeRecording(transcriptId: string): Promise<void> {
  const transcript = db
    .prepare("SELECT * FROM transcripts WHERE id = ?")
    .get(transcriptId) as TranscriptRow | undefined;
  if (!transcript) return;

  const update = (fields: Partial<TranscriptRow>) => {
    const sets = Object.keys(fields).map((k) => `${k} = ?`).join(", ");
    db.prepare(`UPDATE transcripts SET ${sets} WHERE id = ?`).run(
      ...Object.values(fields),
      transcriptId
    );
    broadcast(transcript.session_id, {
      t: "transcript-status",
      recordingId: transcript.recording_id,
      status: fields.status ?? "processing",
    });
  };

  update({ status: "processing" });
  try {
    await ensureModel();

    // Speech comes from per-participant mic tracks; screen audio is skipped.
    // Prefer the uncompressed PCM track when the participant has one.
    const candidates = db
      .prepare(
        `SELECT t.*, p.name AS participant_name FROM tracks t
         JOIN participants p ON p.id = t.participant_id
         WHERE t.recording_id = ? AND t.type IN ('camera', 'pcm') AND t.status = 'ready'`
      )
      .all(transcript.recording_id) as (TrackRow & { participant_name: string })[];
    const byParticipant = new Map<string, (typeof candidates)[number]>();
    for (const track of candidates) {
      const existing = byParticipant.get(track.participant_id);
      if (!existing || (track.type === "pcm" && existing.type !== "pcm")) {
        byParticipant.set(track.participant_id, track);
      }
    }
    const tracks = [...byParticipant.values()];
    if (tracks.length === 0) throw new Error("No ready audio tracks to transcribe");

    const allSegments: TranscriptSegment[] = [];
    const allWords: TranscriptWord[] = [];
    let language: string | null = null;

    for (const track of tracks) {
      const wav = wavTrackPath(track.id);
      if (!fs.existsSync(wav)) continue;

      // whisper.cpp wants 16kHz mono 16-bit WAV
      const wav16 = path.join(DATA_DIR, "media", `${track.id}.16k.wav`);
      await run(process.env.FFMPEG_PATH ?? "ffmpeg", ["-y", "-i", wav, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav16]);

      const outPrefix = path.join(DATA_DIR, "media", `${track.id}.whisper`);
      await run(WHISPER_CLI, [
        "-m", MODEL_PATH,
        "-f", wav16,
        "-l", "auto",
        "-t", "4",
        "-ojf", // full JSON: segment text plus token-level offsets for word timing
        "-of", outPrefix,
        "--no-prints",
      ]);
      const result = JSON.parse(fs.readFileSync(`${outPrefix}.json`, "utf8"));
      language ??= result?.result?.language ?? null;
      for (const seg of result?.transcription ?? []) {
        const text = String(seg.text ?? "").trim();
        if (!text) continue;
        allSegments.push({
          startMs: (seg.offsets?.from ?? 0) + track.start_offset_ms,
          endMs: (seg.offsets?.to ?? 0) + track.start_offset_ms,
          text,
          speaker: track.participant_name,
          trackId: track.id,
        });
        allWords.push(
          ...tokensToWords(seg.tokens ?? [], track.start_offset_ms, track.participant_name, track.id)
        );
      }
      fs.rmSync(wav16, { force: true });
      fs.rmSync(`${outPrefix}.json`, { force: true });
    }

    allSegments.sort((a, b) => a.startMs - b.startMs);
    allWords.sort((a, b) => a.startMs - b.startMs);
    if (allSegments.length === 0) throw new Error("Transcription produced no segments");
    update({
      status: "ready",
      language,
      segments_json: JSON.stringify(allSegments),
      words_json: JSON.stringify(allWords),
      error: null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[transcribe] ${transcriptId} failed:`, message);
    const hint = message.includes("ENOENT")
      ? " (is whisper-cli installed? `brew install whisper-cpp`)"
      : "";
    update({ status: "failed", error: (message + hint).slice(0, 2000) });
  }
}

/**
 * Merge whisper.cpp BPE tokens into words with timestamps.
 * A token starting with a space begins a new word; punctuation-only tokens
 * attach to the previous word; special tokens like [_BEG_] are dropped.
 */
function tokensToWords(
  tokens: { text?: string; offsets?: { from: number; to: number } }[],
  offsetMs: number,
  speaker: string,
  trackId: string
): TranscriptWord[] {
  const words: TranscriptWord[] = [];
  for (const token of tokens) {
    const text = token.text ?? "";
    if (/^\[_.+_\]$/.test(text) || text.trim() === "") continue;
    const from = (token.offsets?.from ?? 0) + offsetMs;
    const to = (token.offsets?.to ?? 0) + offsetMs;
    const startsWord = text.startsWith(" ") || words.length === 0;
    if (startsWord) {
      words.push({ startMs: from, endMs: to, text: text.trim(), speaker, trackId });
    } else {
      const last = words[words.length - 1];
      last.text += text;
      last.endMs = Math.max(last.endMs, to);
    }
  }
  return words.filter((w) => w.text.length > 0);
}

// ---- Caption/text rendering ----

function pad(n: number, len = 2): string {
  return String(n).padStart(len, "0");
}

function timestamp(ms: number, sep: "," | "."): string {
  const clamped = Math.max(0, Math.round(ms));
  const h = Math.floor(clamped / 3_600_000);
  const m = Math.floor((clamped % 3_600_000) / 60_000);
  const s = Math.floor((clamped % 60_000) / 1000);
  const frac = clamped % 1000;
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(frac, 3)}`;
}

export function renderTranscript(
  segments: TranscriptSegment[],
  format: "txt" | "srt" | "vtt"
): string {
  if (format === "txt") {
    const lines: string[] = [];
    let lastSpeaker = "";
    for (const seg of segments) {
      if (seg.speaker !== lastSpeaker) {
        lines.push("", `${seg.speaker}:`);
        lastSpeaker = seg.speaker;
      }
      lines.push(seg.text);
    }
    return lines.join("\n").trim() + "\n";
  }
  if (format === "srt") {
    return (
      segments
        .map(
          (seg, i) =>
            `${i + 1}\n${timestamp(seg.startMs, ",")} --> ${timestamp(seg.endMs, ",")}\n${seg.speaker}: ${seg.text}`
        )
        .join("\n\n") + "\n"
    );
  }
  return (
    "WEBVTT\n\n" +
    segments
      .map(
        (seg) =>
          `${timestamp(seg.startMs, ".")} --> ${timestamp(seg.endMs, ".")}\n<v ${seg.speaker}>${seg.text}`
      )
      .join("\n\n") +
    "\n"
  );
}
