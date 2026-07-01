# Deploying Tributary with real remote guests

Two things separate "works on my machine" from "works with a guest in another city":

1. **HTTPS** — browsers only expose camera/microphone (and screen capture) in a secure context.
   `localhost` is exempt, which is why local dev works without it.
2. **TURN** — the live call is peer-to-peer. STUN (the default) punches through most home NATs,
   but symmetric NATs and strict corporate firewalls need a TURN relay or the call won't connect.
   (Recording is unaffected either way — it's captured locally and uploaded over HTTPS — but
   guests need the live call to have a conversation.)

## 1. Build and run the server

```bash
pnpm build
PORT=4100 pnpm start   # serves API + WS + the built web app on one port
```

Optional environment:

| Var | Purpose | Default |
|---|---|---|
| `PORT` | listen port | `4100` |
| `TRIBUTARY_DATA_DIR` | media/chunk/db storage | `./data` |
| `ICE_SERVERS` | JSON array of RTCIceServer for STUN/TURN | Google STUN |
| `FFMPEG_PATH` / `FFPROBE_PATH` | binaries | `ffmpeg` / `ffprobe` on PATH |

## 2. HTTPS reverse proxy (Caddy — easiest)

```
# Caddyfile
studio.example.com {
    reverse_proxy localhost:4100
}
```

Caddy provisions Let's Encrypt automatically and proxies WebSockets without extra config.
nginx works too — just ensure `Upgrade`/`Connection` headers are forwarded for `/ws`.

**Quick alternatives without a public server:**
- **Tailscale Funnel**: `tailscale funnel 4100` → public HTTPS URL.
- **cloudflared**: `cloudflared tunnel --url http://localhost:4100`.

Both are fine for real sessions; uploads and WS traffic ride the tunnel.

## 3. TURN relay (coturn)

On any small VPS with a public IP:

```bash
apt install coturn
```

`/etc/turnserver.conf`:

```
listening-port=3478
fingerprint
use-auth-secret
static-auth-secret=CHANGE_ME_LONG_RANDOM
realm=studio.example.com
# relay ports
min-port=49152
max-port=65535
```

Then point Tributary at it:

```bash
export ICE_SERVERS='[
  {"urls":["stun:stun.l.google.com:19302"]},
  {"urls":"turn:turn.example.com:3478","username":"tributary","credential":"CHANGE_ME_LONG_RANDOM"}
]'
```

> coturn's `use-auth-secret` mode expects time-limited HMAC credentials; for a small private
> deployment you can use `lt-cred-mech` + `user=tributary:password` instead, which matches the
> static username/credential shown above. Managed alternatives: Cloudflare Calls TURN, Twilio
> NTS, or metered.ca — all hand you an `iceServers` JSON you can paste into `ICE_SERVERS`.

## 4. Checklist for a real session

- [ ] `https://studio.example.com` loads and you can sign in
- [ ] Lobby shows camera preview (proves secure context)
- [ ] Two devices on *different networks* can see/hear each other (proves STUN/TURN)
- [ ] Record 30s, stop, both sides reach "All uploads complete"
- [ ] Tracks reach **ready** and downloads play

## Notes

- SQLite + local disk means **one server instance**; put it on the box with the storage.
- Media directories can get large: `data/chunks` is temporary (deleted after assembly is safe to
  automate later), `data/media` holds originals + deliverables, `data/exports` holds mixes.
- The mesh call is comfortable to ~6 participants; beyond that an SFU (LiveKit) is the plan.
