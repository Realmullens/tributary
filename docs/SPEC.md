# Tributary — Product Spec

*A self-hostable, Riverside-style remote recording studio. Research date: 2026-07-01.*

Tributary reproduces the core value proposition of Riverside (riverside.com): a browser-based
recording studio where the **live call and the final recording are separate systems**. Participants
converse over WebRTC (quality can degrade freely), while each participant's camera and microphone
are **recorded locally on their own device** at full quality, chunked, persisted, and **uploaded
progressively in the background**. The host ends up with separate, synchronized, high-quality
tracks per participant plus mixed exports — regardless of how bad the live connection was.

This is an independent implementation. No Riverside branding, UI, copy, or private APIs are used.

## 1. What Riverside is (verified 2026-07-01)

Findings from primary sources (riverside.com/faq, /pricing, /blog/riverside-2-0) merged with the
prior GPT-5.5 reference spec (`docs/reference/riverside-core-functionality-spec.md` origin):

**Core recording model (all verified):**
- Local per-participant recording with real-time chunked background upload ("progressive upload").
- Crash/network resilience: files stored locally, upload resumes after disconnects and refreshes.
- Separate audio/video tracks per participant; screen shares recorded as their own dedicated tracks.
- Up to 10 recorded participants (host + 9 guests); more can join unrecorded.
- Guests join via link — no account, no install. Optional waiting-lobby gating with host admit.
- Quality is plan-gated: free = 720p/44.1kHz, Pro+ = up to 4K video / 48kHz WAV audio. Default 24fps.
- Lobby flow asks "are you wearing headphones?" to decide echo cancellation; device pickers +
  camera preview + mic meter; host can see (not change) each guest's devices.
- In-studio: grid of tiles, chat sidebar, per-participant volume/mute for host, noise reduction
  toggle, teleprompter, media board (soundboard), countdown before record, auto-record option,
  per-participant upload progress after stop, "pause uploads" toggle for weak connections.

**Post-session (verified):**
- Dashboard: studios → recordings list → per-recording page with raw per-participant tracks, each
  individually downloadable, plus Download All, transcription, and editor entry.
- Editor: text-based (edit the transcript, video follows) + timeline; exports MP3/WAV/MP4 up to 4K
  and Premiere/FCP XML; edited separate tracks per speaker.
- AI suite (2025–2026): Magic Clips, Magic Audio, filler/silence removal, eye-contact correction,
  AI Co-Creator chat editing, Magic Episode, show notes, translation/dubbing, animated captions.
- Distribution: podcast/video hosting, live streaming + RTMP multistream, webinars, watch pages
  with audience call-ins, newsletters, social scheduling.
- Roles: host, guest, producer (not recorded; Business tier), audience.

## 2. Scope for Tributary v0.1 (this build)

**In scope — the defining core:**
1. Host accounts (email/password), studios, recording sessions.
2. Guest join via tokenized invite link, no account.
3. Lobby: name entry, camera/mic/speaker pickers, live preview, mic level meter, echo-cancellation
   (headphones) toggle.
4. Live studio room: mesh WebRTC call (host + up to ~5 guests), tiles with mute/camera state,
   screen share, text chat, presence.
5. Recording control: host starts/stops; server issues the authoritative start timestamp and
   broadcasts to all clients; optional per-client clock-offset estimation via WS ping.
6. Local recording per participant: MediaRecorder (webm/vp8+opus preferred, runtime codec
   detection), ~3s timeslice, every chunk persisted to IndexedDB **before** upload.
7. Progressive resumable upload: chunk-by-index PUTs, retry with backoff, resume from
   server-reported received set, survives refresh (recovery scan of IndexedDB on rejoin).
8. Screen share recorded as an additional local track.
9. Post-stop upload screen: progress %, "don't close this tab" warning, done state.
10. Host visibility: live per-participant upload health in the room + session detail page.
11. Processing pipeline (ffmpeg): assemble chunks → probe → per-track MP4 (H.264/AAC) + WAV audio
    extraction → mixed grid MP4 + mixed WAV using per-track start offsets.
12. Session detail dashboard: participants, tracks with statuses, per-track downloads (raw webm /
    MP4 / WAV), mixed exports, reprocess.

**Explicitly deferred** (architecture leaves room): SFU (LiveKit) for >5 guests, true PCM/WAV
capture via AudioWorklet, transcription (whisper), text-based editing, clips, teleprompter, media
board, live streaming/RTMP, webinars, mobile apps, producer/audience roles, waveform-based sync
correction, S3 storage backend.

## 3. Architecture

```
web (Vite + React + TS + Tailwind)
 ├─ rtc/        mesh WebRTC, perfect negotiation, signaling over WS
 ├─ recorder/   MediaRecorder engine → IndexedDB chunk store → upload manager (resume/backoff)
 └─ pages/      auth, dashboard, studio, lobby, room, session detail

server (Fastify + better-sqlite3, single process)
 ├─ REST API    auth, studios, sessions, invites, recording control, tracks, chunks, exports
 ├─ WS /ws      rooms: presence, WebRTC signal relay, chat, state, upload progress, clock ping
 ├─ jobs        in-process queue → ffmpeg: assemble/probe/remux/wav/mixed-export
 └─ storage     local disk under data/ (chunks/, media/, exports/) — swappable for S3 later
```

**Why mesh WebRTC (not an SFU) for v0.1:** the live call is only for conversation; final quality
comes from local recording. Mesh keeps the stack self-contained (no Docker/LiveKit dependency) and
is fine to ~6 participants. The signaling protocol is transport-agnostic so an SFU can replace the
mesh without touching the recorder.

**Sync model:** server records `started_at_ms` when host hits record and broadcasts it. Each client
estimates clock offset via WS ping (NTP-style midpoint), starts its recorders, and reports
`start_offset_ms = (local recorder start, mapped to server clock) − started_at_ms` when creating
each track. The mixer delays each track by its offset. Waveform alignment is a future refinement.

**Upload/recovery invariants:**
- A chunk is written to IndexedDB before it is queued for upload; upload deletes it only after 2xx.
- Chunk PUTs are idempotent (`PUT /api/tracks/:id/chunks/:idx`); server keeps a received-set.
- On rejoin/refresh, client lists local tracks in IndexedDB, asks server which chunks it has, and
  uploads the difference, then finalizes.
- Finalize declares `final_chunk_count`; server marks a track `uploaded` only when all chunks are
  present, then queues processing.

## 4. Data model

users, auth_tokens, studios, sessions (invite_token, status), participants (role host|guest,
bearer token), recordings (one per record start/stop "take", authoritative timestamps),
tracks (recording_id, participant_id, type camera|screen, mime, status, start_offset_ms,
final_chunk_count), chunks (track_id, idx, size), exports (mixed_video|mixed_audio per recording).

Track status: `recording → uploading → uploaded → processing → ready | failed`.

## 5. Quality presets

Lobby/room capture constraints: Standard 720p30 (default), High 1080p30, Audio-only. MediaRecorder
bitrates: 5 Mbps video @720p, 8 Mbps @1080p, 128 kbps Opus audio. WAV is extracted server-side
from Opus for post-production convenience (true PCM capture deferred).

## 6. Security

Scoped bearer tokens per participant; signed-in cookie auth for hosts; all track/chunk/export
endpoints check ownership or participant membership; invite tokens are unguessable (32-char);
media served only through authenticated endpoints; recording indicator visible whenever local
recording is active.
