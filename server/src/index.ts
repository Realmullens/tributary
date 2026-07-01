import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyCors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "./lib/db.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerStudioRoutes } from "./routes/studios.js";
import { registerSessionRoutes } from "./routes/sessions.js";
import { registerTrackRoutes } from "./routes/tracks.js";
import { registerMediaRoutes } from "./routes/media.js";
import { registerWsRoutes } from "./routes/ws.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 4100);

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? "info" },
  bodyLimit: 64 * 1024 * 1024, // MediaRecorder chunks can be several MB
});

// Raw media chunk bodies
app.addContentTypeParser("application/octet-stream", { parseAs: "buffer" }, (_req, body, done) => {
  done(null, body);
});

await app.register(fastifyCookie);
await app.register(fastifyCors, {
  origin: true,
  credentials: true,
});
await app.register(fastifyWebsocket, {
  options: { maxPayload: 1024 * 1024 },
});

registerAuthRoutes(app);
registerStudioRoutes(app);
registerSessionRoutes(app);
registerTrackRoutes(app);
registerMediaRoutes(app);
registerWsRoutes(app);

app.get("/api/health", async () => ({ ok: true, name: "tributary", now: Date.now() }));

// Serve the built web app in production
const webDist = path.resolve(__dirname, "../../web/dist");
if (fs.existsSync(webDist)) {
  // wildcard:true serves files from disk per-request, so a web rebuild
  // (new hashed bundle names) doesn't require a server restart.
  await app.register(fastifyStatic, { root: webDist, wildcard: true });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api/") || req.url.startsWith("/ws")) {
      return reply.code(404).send({ error: "Not found" });
    }
    return reply.sendFile("index.html");
  });
}

app
  .listen({ port: PORT, host: "0.0.0.0" })
  .then(() => console.log(`Tributary server listening on http://localhost:${PORT}`))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
