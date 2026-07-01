# Tributary

A self-hostable, browser-based **remote recording studio** in the style of Riverside: a live
video call for conversation, while every participant's camera and microphone are **recorded
locally on their own device at full quality**, chunked, persisted, and **uploaded progressively
in the background**. The host ends up with separate, synchronized, high-quality tracks per
participant — plus mixed exports — no matter how rough the live connection was.

## Core features

- **Studios → sessions → invite links.** Hosts sign up; guests join with one link, no account.
- **Lobby / device check** — camera preview, mic level meter, camera/mic pickers, quality preset
  (720p / 1080p / 4K / audio-only), "I'm wearing headphones" echo-cancellation toggle.
- **Live studio room** — mesh WebRTC (host + up to ~5 guests), tiles with mute/camera state,
  screen sharing, text chat, presence, reconnecting states, and a stall watchdog that rebuilds
  peer connections whose ICE agent never comes up.
- **Waiting room** — optional per-session lobby: guests hold until the host admits or declines;
  admitted guests skip the queue on refresh.
- **Host controls** — force-mute any guest; per-tile local volume sliders.
- **Teleprompter** — host-editable script synced to every participant, with per-person
  auto-scroll speed and font size.
- **Local-first recording** — host hits Record; a server-side countdown broadcasts to everyone,
  then the server issues the authoritative start timestamp; each client records its own devices
  with `MediaRecorder` (3s chunks). Every chunk is written to IndexedDB *before* upload, then
  uploaded with retry/backoff. Live-call quality and recording quality are fully decoupled.
  Optional **auto-record** starts the take when the first guest joins.
- **Pause uploads** — defer bandwidth use on weak connections while local recording continues.
- **True 48kHz WAV capture** — an AudioWorklet taps the mic and records uncompressed PCM as a
  separate per-participant track (no codec round-trip), used preferentially for mixes and
  transcription. Toggle in the lobby, on by default.
- **Screen shares are their own recorded tracks**, start/stoppable mid-recording.
- **Upload resilience** — idempotent chunk-by-index uploads, resume after refresh/offline, and a
  recovery banner that scans IndexedDB on any page load and finishes uploads from crashed tabs
  (verified by an automated kill-the-tab-mid-recording test).
- **Track sync** — clients estimate server clock offset over WebSocket pings; each track stores
  its start offset so independently recorded files align in the mixer.
- **Post-production pipeline (ffmpeg)** — chunks are assembled, probed, and delivered as:
  per-participant **MP4** (H.264/AAC) + **48kHz WAV** + original raw webm, and per-take
  **mixed grid MP4** and **mixed WAV** with per-track offset alignment.
- **Transcription + captions** — per-track whisper.cpp transcription with **speaker labels from
  the separate tracks** and offset-aligned timestamps; TXT / SRT / VTT downloads and an inline
  transcript viewer. (Uses `whisper-cli` — `brew install whisper-cpp`; the model auto-downloads
  on first use.)
- **Session dashboard** — takes, participants, per-track status (chunk counts while uploading),
  downloads, mixed exports, transcripts, retry-processing, auto-record and waiting-room toggles.
- **Premiere/FCP XML export** — one click gives you an xmeml timeline that drops the downloaded
  MP4/WAV tracks onto synced tracks in Premiere Pro or DaVinci Resolve, offsets applied.
- **Editor** — per-recording editor with synced multi-track preview, click-to-seek timeline,
  trim + cut ranges, and a transcript rail (click a line to jump there; cut lines get struck
  through). Edits render server-side into new mixed exports — non-destructive throughout.
- **TURN-ready** — set `ICE_SERVERS` to add a TURN relay for guests behind strict NATs; see
  [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for HTTPS + coturn recipes.

## Quick start

Requires Node 20+, pnpm, and ffmpeg/ffprobe on PATH (`brew install ffmpeg`).

```bash
pnpm install
pnpm dev          # server on :4100, web dev server on :4110
```

Open http://localhost:4110, create an account, a studio, and a session, then "Enter studio".
Copy the invite link for guests. To test locally, open the invite link in a second browser
window — camera/mic work on localhost without HTTPS.

Production-style single process (server serves the built SPA):

```bash
pnpm build
pnpm start        # everything on :4100
```

> **HTTPS note:** browsers require a secure context for camera/mic. `localhost` is fine for
> development; to record with remote guests, put the server behind HTTPS (Caddy, nginx +
> certbot, Tailscale Funnel, or a tunnel like `cloudflared`).

## Architecture

```
web  (Vite + React + TS + Tailwind)
 ├─ lib/rtc        WS signaling client (clock sync) + mesh WebRTC (perfect negotiation)
 ├─ lib/recorder   MediaRecorder engine → IndexedDB chunk store → resumable upload manager
 └─ pages          auth, dashboard, studio, lobby, room, session detail

server  (Fastify + better-sqlite3, single process)
 ├─ REST API       auth, studios, sessions, invites, recording control, tracks, chunks, exports
 ├─ WS /ws         rooms: presence, WebRTC relay, chat, state, upload health, clock pings
 ├─ jobs           in-process queue → ffmpeg (assemble / probe / MP4 / WAV / mixed exports)
 └─ storage        local disk under data/ (chunks/, media/, exports/)
```

Design decisions, the full product spec (based on research of Riverside's public behavior), and
the build plan live in [`docs/SPEC.md`](docs/SPEC.md) and [`docs/PLAN.md`](docs/PLAN.md).

**Why mesh WebRTC instead of an SFU?** The live call only carries the conversation — final media
comes from local recordings — so mesh keeps the stack dependency-free and is fine to ~6
participants. The signaling protocol is transport-agnostic; swapping in an SFU (LiveKit) is the
documented upgrade path for larger rooms.

## Upload / recovery invariants

1. A chunk is persisted to IndexedDB **before** it's queued for upload, and deleted only after a
   confirmed 2xx.
2. Chunk PUTs are idempotent (`PUT /api/tracks/:id/chunks/:idx`); duplicates are no-ops.
3. On any page load, a recovery scanner finds unfinished local tracks, asks the server which
   chunks it already has, uploads the difference, and finalizes (crashed tabs included — the
   participant token is stored with the track).
4. A track is marked `uploaded` only when the server holds every declared chunk; processing then
   assembles them into a continuous file (MediaRecorder chunks concatenate losslessly).

## Testing

- `pnpm typecheck` — both packages.
- `scratchpad` E2E suites (run during development, all passing):
  - **API smoke** — full flow via curl: register → studio → session → join → record → chunked
    upload (with duplicate-chunk idempotency check) → finalize → processing → byte-identical raw
    download → MP4/WAV probe → mixed exports with offset alignment → authz checks.
  - **Browser E2E** — headless Chrome with fake devices: two participants, live video both ways,
    chat, record 12s, live chunk upload, "All uploads complete", tracks → ready.
  - **Crash recovery** — guest forced offline mid-recording, tab killed, then reopened: recovery
    banner resumes from IndexedDB, track finalizes and processes to ready.

## Current limitations / roadmap

- Mesh topology tops out around 6 participants → LiveKit/SFU integration for 8–10.
- 4K preset depends on the camera/browser actually delivering 2160p and is encoder-heavy;
  1080p is the recommended ceiling for most machines.
- Editor covers trim/cuts/transcript-seek; word-level text editing, layout switching, and AI
  clips are the next tier (see `docs/SPEC.md` §2 for the full deferred list).
- Local-disk storage and in-process job queue — swap for S3 + a real queue to scale out.
- Device switching is locked while recording.

Tributary is an independent implementation inspired by Riverside's public product behavior. It
uses no Riverside code, branding, or assets.
