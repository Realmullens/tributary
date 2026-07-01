import { AccessToken } from "livekit-server-sdk";

/**
 * Optional SFU mode. When LIVEKIT_URL/KEY/SECRET are set, clients carry media
 * through LiveKit instead of the built-in mesh — same signaling, same local
 * recording, but the live call scales past mesh's ~6 participant ceiling.
 *
 * Local dev:  brew install livekit && livekit-server --dev
 *   (dev mode uses key "devkey" / secret "secret" on ws://localhost:7880)
 */
export function livekitConfig(): { url: string; apiKey: string; apiSecret: string } | null {
  const url = process.env.LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!url || !apiKey || !apiSecret) return null;
  return { url, apiKey, apiSecret };
}

export async function mintLivekitToken(
  sessionId: string,
  participantId: string,
  name: string
): Promise<string> {
  const config = livekitConfig();
  if (!config) throw new Error("LiveKit is not configured");
  const token = new AccessToken(config.apiKey, config.apiSecret, {
    identity: participantId,
    name,
    ttl: "12h",
  });
  token.addGrant({
    room: sessionId,
    roomJoin: true,
    roomCreate: true,
    canPublish: true,
    canSubscribe: true,
  });
  return token.toJwt();
}
