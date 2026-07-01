# Tributary — Build Plan

## Stack decision

| Layer | Choice | Rationale |
|---|---|---|
| Frontend | Vite + React 18 + TypeScript + Tailwind v3 | Fast dev, no SSR needed for an app behind auth |
| Live call | Native WebRTC mesh + custom WS signaling | Self-contained; call quality is decoupled from recording quality by design. SFU (LiveKit) is the documented upgrade path for >6 participants |
| Server | Fastify 5 + @fastify/websocket | Single process serves API + WS + static build |
| DB | better-sqlite3 (WAL) | Zero-dependency local persistence; schema kept portable to Postgres |
| Storage | Local disk under `data/` | Abstracted in `lib/storage.ts`; S3/R2 later |
| Uploads | Custom idempotent chunk-by-index PUTs | Simpler than tus for MediaRecorder's natural chunk stream; same resume semantics |
| Jobs | In-process async queue | ffmpeg work is per-track and short; BullMQ/Redis when scaling out |
| Media | ffmpeg / ffprobe (system binaries) | Assemble, remux MP4, extract WAV, mixed grid export |

## Milestones

1. **Skeleton** — monorepo, workspaces, tsconfigs, Fastify boot, SQLite schema. ✅ scaffolded
2. **Core API** — auth (scrypt + cookie sessions), studios CRUD, sessions + invite tokens,
   guest join, host room-token issuance.
3. **Signaling** — WS rooms: welcome/peer-joined/peer-left, signal relay, chat, state
   (mic/cam/sharing), upload progress relay, clock-sync ping, recording start/stop broadcast.
4. **Recorder client** — device manager, MediaRecorder engine (codec detection, 3s timeslice),
   IndexedDB chunk store, upload manager (concurrency 2, exponential backoff, resume), recovery.
5. **Room UI** — lobby (pickers, preview, meter, headphones toggle), tile grid, controls
   (mute/cam/share/record/leave), chat panel, recording timer, upload health, post-stop screen.
6. **Processing** — finalize → assemble → probe → MP4 + WAV per track; mixed grid MP4/WAV per
   recording with `start_offset_ms` alignment; export rows + download endpoints.
7. **Dashboard** — studios list, studio page (sessions, invite links), session detail (takes,
   participants, tracks, statuses, downloads, exports, reprocess).
8. **Verify + docs** — typecheck, end-to-end browser smoke test with fake media devices, README.

## Test plan

- `pnpm typecheck` both packages.
- E2E smoke: register → create studio → create session → open room as host (Chrome with
  `--use-fake-device-for-media-stream`) → record 10s → stop → wait for upload + processing →
  assert track `ready` → download MP4/WAV → create mixed export → assert playable via ffprobe.
- Resume test: kill network (devtools offline) mid-upload, restore, assert no duplicate chunks and
  final assembly integrity (chunk count + ffprobe duration).
