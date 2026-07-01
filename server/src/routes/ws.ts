import type { FastifyInstance } from "fastify";
import { participantFromToken } from "../lib/auth.js";
import { addClient, handleClientMessage, removeClient } from "../lib/rooms.js";

export function registerWsRoutes(app: FastifyInstance): void {
  app.get("/ws", { websocket: true }, (socket, req) => {
    const url = new URL(req.url ?? "/ws", "http://localhost");
    const token = url.searchParams.get("token");
    const participant = token ? participantFromToken(token) : null;
    if (!participant) {
      socket.close(4401, "invalid token");
      return;
    }

    const client = addClient(participant, socket);
    socket.on("message", (data: Buffer | string) => {
      handleClientMessage(client, data.toString());
    });
    socket.on("close", () => removeClient(client));
    socket.on("error", () => removeClient(client));
  });
}
