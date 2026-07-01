import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";
import { participantFromToken, requireParticipant } from "../lib/auth.js";
import {
  ensureWatchToken,
  hlsDirFor,
  sessionForWatchToken,
  startStream,
  stopStream,
  streamStatus,
  writeStreamChunk,
} from "../lib/streaming.js";

export function registerWatchRoutes(app: FastifyInstance): void {
  // ---- Host: live stream ingest over WS (binary WebM chunks) ----
  app.get("/stream-ingest", { websocket: true }, (socket, req) => {
    const url = new URL(req.url ?? "/stream-ingest", "http://localhost");
    const token = url.searchParams.get("token");
    const participant = token ? participantFromToken(token) : null;
    if (!participant || participant.role !== "host") {
      socket.close(4401, "host token required");
      return;
    }
    const sessionId = participant.session_id;
    const rtmpUrl = url.searchParams.get("rtmp") || null;
    if (rtmpUrl && !/^rtmps?:\/\//.test(rtmpUrl)) {
      socket.close(4400, "invalid rtmp url");
      return;
    }
    startStream(sessionId, rtmpUrl);

    socket.on("message", (data: Buffer, isBinary: boolean) => {
      if (isBinary) writeStreamChunk(sessionId, data);
    });
    socket.on("close", () => stopStream(sessionId));
    socket.on("error", () => stopStream(sessionId));
  });

  // ---- Host: live status + watch link ----
  app.get("/api/live-status", async (req, reply) => {
    const participant = requireParticipant(req, reply);
    if (!participant) return;
    const status = streamStatus(participant.session_id);
    const watchToken = ensureWatchToken(participant.session_id);
    return { ...status, watchToken };
  });

  // ---- Public: watch page data + HLS files ----
  app.get("/api/watch/:watchToken", async (req, reply) => {
    const { watchToken } = req.params as { watchToken: string };
    const session = sessionForWatchToken(watchToken);
    if (!session) return reply.code(404).send({ error: "Invalid watch link" });
    const status = streamStatus(session.id);
    // Only advertise the playlist once ffmpeg has actually written it —
    // otherwise players hit a 404 during the first couple of seconds.
    const playlistReady =
      status.live && fs.existsSync(path.join(hlsDirFor(session.id), "index.m3u8"));
    return {
      title: session.title,
      live: status.live,
      hlsUrl: playlistReady ? `/api/watch/${watchToken}/hls/index.m3u8` : null,
    };
  });

  app.get("/api/watch/:watchToken/hls/:file", async (req, reply) => {
    const { watchToken, file } = req.params as { watchToken: string; file: string };
    const session = sessionForWatchToken(watchToken);
    if (!session) return reply.code(404).send({ error: "Invalid watch link" });
    if (!/^[\w.-]+$/.test(file)) return reply.code(400).send({ error: "Bad path" });
    const filePath = path.join(hlsDirFor(session.id), file);
    if (!fs.existsSync(filePath)) return reply.code(404).send({ error: "Not found" });
    reply.header(
      "Content-Type",
      file.endsWith(".m3u8") ? "application/vnd.apple.mpegurl" : "video/mp2t"
    );
    reply.header("Cache-Control", "no-cache");
    return reply.send(fs.createReadStream(filePath));
  });
}
