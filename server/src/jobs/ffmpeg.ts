import { execFile } from "node:child_process";

const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH ?? "ffprobe";

function run(bin: string, args: string[], timeoutMs = 30 * 60 * 1000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`${bin} ${args.join(" ")} failed: ${stderr?.slice(-2000) || err.message}`));
      } else {
        resolve(stdout);
      }
    });
  });
}

export type ProbeResult = {
  durationMs: number | null;
  hasVideo: boolean;
  hasAudio: boolean;
  width: number | null;
  height: number | null;
};

export async function probe(filePath: string): Promise<ProbeResult> {
  const out = await run(FFPROBE, [
    "-v", "error",
    "-show_streams",
    "-show_format",
    "-of", "json",
    filePath,
  ]);
  const data = JSON.parse(out);
  const streams: any[] = data.streams ?? [];
  const video = streams.find((s) => s.codec_type === "video");
  const audio = streams.find((s) => s.codec_type === "audio");
  // MediaRecorder webm often lacks container duration; fall back to stream tags or null.
  const durationSec = Number.parseFloat(data.format?.duration ?? video?.duration ?? audio?.duration ?? "");
  return {
    durationMs: Number.isFinite(durationSec) ? Math.round(durationSec * 1000) : null,
    hasVideo: Boolean(video),
    hasAudio: Boolean(audio),
    width: video?.width ?? null,
    height: video?.height ?? null,
  };
}

/** Transcode an assembled MediaRecorder file into a clean, seekable MP4 (H.264/AAC). */
export async function toMp4(input: string, output: string, hasAudio: boolean): Promise<void> {
  const args = ["-y", "-i", input, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
    "-pix_fmt", "yuv420p", "-fps_mode", "cfr", "-r", "30"];
  if (hasAudio) args.push("-c:a", "aac", "-b:a", "192k", "-ar", "48000");
  else args.push("-an");
  args.push("-movflags", "+faststart", output);
  await run(FFMPEG, args);
}

/** Extract a 48kHz stereo WAV from any track (audio post-production deliverable). */
export async function toWav(input: string, output: string): Promise<void> {
  await run(FFMPEG, ["-y", "-i", input, "-vn", "-ac", "2", "-ar", "48000", "-c:a", "pcm_s16le", output]);
}

/** Wrap a headerless s16le PCM stream (AudioWorklet capture) into a WAV container. */
export async function rawPcmToWav(
  input: string,
  output: string,
  sampleRate: number,
  channels: number
): Promise<void> {
  await run(FFMPEG, [
    "-y",
    "-f", "s16le", "-ar", String(sampleRate), "-ac", String(channels),
    "-i", input,
    "-c:a", "pcm_s16le",
    output,
  ]);
}

export type MixInput = {
  filePath: string;
  offsetMs: number;
  hasVideo: boolean;
  hasAudio: boolean;
  label: string;
};

/**
 * Render a grid-layout mixed MP4 from per-participant tracks.
 * Each track is delayed by its start offset so independently recorded files align.
 */
export async function mixedVideoExport(
  inputs: MixInput[],
  output: string,
  totalDurationMs: number,
  size = { w: 1920, h: 1080 }
): Promise<void> {
  const videoInputs = inputs.filter((i) => i.hasVideo);
  const audioInputs = inputs.filter((i) => i.hasAudio);
  if (videoInputs.length === 0) throw new Error("No video tracks to mix");

  const cols = Math.ceil(Math.sqrt(videoInputs.length));
  const rows = Math.ceil(videoInputs.length / cols);
  const cellW = Math.floor(size.w / cols / 2) * 2;
  const cellH = Math.floor(size.h / rows / 2) * 2;

  const args: string[] = ["-y"];
  for (const input of inputs) args.push("-i", input.filePath);

  const filters: string[] = [
    `color=c=0x111318:s=${size.w}x${size.h}:r=30:d=${(totalDurationMs / 1000).toFixed(3)}[base]`,
  ];
  let lastVideo = "base";
  videoInputs.forEach((input, vi) => {
    const inputIdx = inputs.indexOf(input);
    const col = vi % cols;
    const row = Math.floor(vi / cols);
    const x = col * cellW + Math.floor((size.w - cols * cellW) / 2);
    const y = row * cellH + Math.floor((size.h - rows * cellH) / 2);
    const offsetSec = (input.offsetMs / 1000).toFixed(3);
    filters.push(
      `[${inputIdx}:v]scale=${cellW}:${cellH}:force_original_aspect_ratio=decrease,` +
        `pad=${cellW}:${cellH}:(ow-iw)/2:(oh-ih)/2:color=0x111318,` +
        `setpts=PTS-STARTPTS+${offsetSec}/TB[v${vi}]`
    );
    const next = vi === videoInputs.length - 1 ? "vout" : `tmp${vi}`;
    filters.push(`[${lastVideo}][v${vi}]overlay=${x}:${y}:eof_action=pass[${next}]`);
    lastVideo = next;
  });

  if (audioInputs.length > 0) {
    const audioLabels: string[] = [];
    audioInputs.forEach((input, ai) => {
      const inputIdx = inputs.indexOf(input);
      const delay = Math.max(0, Math.round(input.offsetMs));
      filters.push(
        `[${inputIdx}:a]aresample=async=1:first_pts=0,adelay=${delay}|${delay}[a${ai}]`
      );
      audioLabels.push(`[a${ai}]`);
    });
    filters.push(`${audioLabels.join("")}amix=inputs=${audioInputs.length}:normalize=0:dropout_transition=0[aout]`);
  }

  args.push("-filter_complex", filters.join(";"));
  args.push("-map", "[vout]");
  if (audioInputs.length > 0) args.push("-map", "[aout]", "-c:a", "aac", "-b:a", "192k");
  args.push(
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p",
    "-t", (totalDurationMs / 1000).toFixed(3),
    "-movflags", "+faststart",
    output
  );
  await run(FFMPEG, args);
}

/** Render a mixed WAV (all audio tracks aligned and summed). */
export async function mixedAudioExport(
  inputs: MixInput[],
  output: string,
  totalDurationMs: number
): Promise<void> {
  const audioInputs = inputs.filter((i) => i.hasAudio);
  if (audioInputs.length === 0) throw new Error("No audio tracks to mix");

  const args: string[] = ["-y"];
  for (const input of audioInputs) args.push("-i", input.filePath);
  const filters: string[] = [];
  const labels: string[] = [];
  audioInputs.forEach((input, ai) => {
    const delay = Math.max(0, Math.round(input.offsetMs));
    filters.push(`[${ai}:a]aresample=async=1:first_pts=0,adelay=${delay}|${delay}[a${ai}]`);
    labels.push(`[a${ai}]`);
  });
  filters.push(`${labels.join("")}amix=inputs=${audioInputs.length}:normalize=0:dropout_transition=0[aout]`);
  args.push(
    "-filter_complex", filters.join(";"),
    "-map", "[aout]",
    "-ac", "2", "-ar", "48000", "-c:a", "pcm_s16le",
    "-t", (totalDurationMs / 1000).toFixed(3),
    output
  );
  await run(FFMPEG, args);
}
