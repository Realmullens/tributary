import type { TrackRow } from "./db.js";
import { trackDownloadBase } from "./filenames.js";

const FPS = 30;

type XmlTrack = TrackRow & { participant_name: string };

function frames(ms: number): number {
  return Math.max(0, Math.round((ms * FPS) / 1000));
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * FCP7 XML (xmeml v4) timeline: one video track per camera/screen recording and
 * one audio track per participant, each clip placed at its sync offset.
 * Imports into Premiere Pro, DaVinci Resolve, and Final Cut (via conversion).
 * File references are relative — put this XML in the same folder as the
 * downloaded track files.
 */
export function buildFcpXml(sequenceName: string, tracks: XmlTrack[]): string {
  const ready = tracks.filter((t) => t.status === "ready" && t.duration_ms);

  const videoTracks = ready.filter((t) => t.width !== null);
  // One audio source per participant: prefer the uncompressed PCM track.
  const audioByParticipant = new Map<string, XmlTrack>();
  for (const t of ready) {
    if (t.type === "screen") continue;
    const existing = audioByParticipant.get(t.participant_id);
    if (!existing || (t.type === "pcm" && existing.type !== "pcm")) {
      audioByParticipant.set(t.participant_id, t);
    }
  }
  const audioTracks = [...audioByParticipant.values()];

  const totalFrames = Math.max(
    ...ready.map((t) => frames(Math.max(0, t.start_offset_ms) + (t.duration_ms ?? 0))),
    1
  );

  let clipId = 0;
  const videoXml = videoTracks
    .map((t) => {
      const base = trackDownloadBase(t.participant_name, t.type, t.id);
      const start = frames(Math.max(0, t.start_offset_ms));
      const dur = frames(t.duration_ms ?? 0);
      clipId++;
      return `      <track>
        <clipitem id="clip-v${clipId}">
          <name>${esc(base)}</name>
          <duration>${dur}</duration>
          <rate><timebase>${FPS}</timebase><ntsc>FALSE</ntsc></rate>
          <start>${start}</start>
          <end>${start + dur}</end>
          <in>0</in>
          <out>${dur}</out>
          <file id="file-v${clipId}">
            <name>${esc(base)}.mp4</name>
            <pathurl>./${esc(base)}.mp4</pathurl>
            <rate><timebase>${FPS}</timebase><ntsc>FALSE</ntsc></rate>
            <duration>${dur}</duration>
            <media>
              <video>
                <samplecharacteristics>
                  <width>${t.width}</width>
                  <height>${t.height}</height>
                </samplecharacteristics>
              </video>
              <audio><channelcount>2</channelcount></audio>
            </media>
          </file>
        </clipitem>
      </track>`;
    })
    .join("\n");

  const audioXml = audioTracks
    .map((t) => {
      const base = trackDownloadBase(t.participant_name, t.type, t.id);
      const start = frames(Math.max(0, t.start_offset_ms));
      const dur = frames(t.duration_ms ?? 0);
      clipId++;
      return `      <track>
        <clipitem id="clip-a${clipId}">
          <name>${esc(t.participant_name)} audio</name>
          <duration>${dur}</duration>
          <rate><timebase>${FPS}</timebase><ntsc>FALSE</ntsc></rate>
          <start>${start}</start>
          <end>${start + dur}</end>
          <in>0</in>
          <out>${dur}</out>
          <file id="file-a${clipId}">
            <name>${esc(base)}.wav</name>
            <pathurl>./${esc(base)}.wav</pathurl>
            <rate><timebase>${FPS}</timebase><ntsc>FALSE</ntsc></rate>
            <duration>${dur}</duration>
            <media>
              <audio>
                <samplecharacteristics>
                  <depth>16</depth>
                  <samplerate>48000</samplerate>
                </samplecharacteristics>
                <channelcount>2</channelcount>
              </audio>
            </media>
          </file>
          <sourcetrack><mediatype>audio</mediatype><trackindex>1</trackindex></sourcetrack>
        </clipitem>
      </track>`;
    })
    .join("\n");

  const dims = videoTracks[0] ?? { width: 1920, height: 1080 };

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="4">
  <sequence id="sequence-1">
    <name>${esc(sequenceName)}</name>
    <duration>${totalFrames}</duration>
    <rate><timebase>${FPS}</timebase><ntsc>FALSE</ntsc></rate>
    <media>
      <video>
        <format>
          <samplecharacteristics>
            <rate><timebase>${FPS}</timebase><ntsc>FALSE</ntsc></rate>
            <width>${dims.width}</width>
            <height>${dims.height}</height>
          </samplecharacteristics>
        </format>
${videoXml}
      </video>
      <audio>
${audioXml}
      </audio>
    </media>
  </sequence>
</xmeml>
`;
}
