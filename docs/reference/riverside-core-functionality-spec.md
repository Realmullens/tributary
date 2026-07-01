# Riverside Core Functionality Spec

Research date: 2026-07-01

Purpose: This document summarizes the core public behavior of Riverside and converts it into a practical build specification for an open-source, Riverside-inspired MVP. It is intended as a handoff document for a coding agent.

Important: Riverside is a proprietary product. This spec describes public product behavior and a recommended independent implementation. Do not copy Riverside branding, UI, copy, private APIs, visual identity, or trademarks.

## 1. Product Summary

Riverside is a browser and mobile-based remote recording studio for podcasts, interviews, webinars, and creator video. Its core value is not merely video conferencing. Its core value is local-first, high-quality recording from every participant, with files uploaded to the cloud and made available as separate synchronized tracks for editing, transcription, clips, and export.

At a product level, Riverside combines:

- A live WebRTC-style recording room where participants can see and hear each other.
- Local audio/video recording on each participant's device.
- Background cloud upload during the session.
- Separate high-quality audio and video tracks per participant.
- Screen share recording as an additional track.
- Guest invite links with no required guest account.
- A dashboard where hosts can access sessions and media.
- Editing tools built around transcripts, layouts, captions, and clips.
- AI-assisted post-production such as transcription, filler removal, clip generation, show notes, captions, and promotional assets.

The central behavior to reproduce for an MVP is:

```text
Live call for conversation
+ local recording per participant
+ resumable background upload
+ synchronized separate tracks
+ host dashboard for downloads and exports
```

## 2. Publicly Sourced Riverside Behavior

The following behaviors are based on Riverside's public pages and app listing.

### 2.1 Local Recording

Riverside records each participant's audio and video directly on that participant's device. As the session progresses, the recording uploads to the cloud in the background. This is the defining feature: final recording quality is intended to remain high even if the live internet connection lags or drops.

Source: Riverside FAQ, "What does locally recorded mean?"  
https://riverside.com/faq

### 2.2 Recording Quality

Riverside publicly claims recording quality up to:

- 4K video, when the device/camera supports it.
- 48kHz WAV audio, when the equipment supports it.

Source: Riverside FAQ, "So, what recording quality should I expect with Riverside?"  
https://riverside.com/faq

### 2.3 Separate Tracks

Riverside provides separate audio and video tracks per recorded participant. This allows editors to remove crosstalk, adjust layouts, isolate speakers, download individual files, and create mixed exports.

Sources:

- Riverside FAQ, multiple participant recording: https://riverside.com/faq
- Riverside pricing, separate audio and video tracks: https://riverside.com/pricing
- Riverside video editor, separate tracks per speaker: https://riverside.com/video-editor

### 2.4 Participant Limits

Riverside's FAQ says users can record up to 10 participants, described as 9 guests plus the host. Its Android app listing says up to 8 participants. For an MVP, target 1 host plus 3 guests, with an architecture that can later support 8 to 10 recorded participants.

Sources:

- Riverside FAQ: https://riverside.com/faq
- Riverside Android listing: https://play.google.com/store/apps/details?id=riverside.fm

### 2.5 Guest Join Flow

Guests do not need a Riverside account to join and be recorded. They can click a host-provided link, pass through a lobby/device setup flow, and enter the studio.

Source: Riverside FAQ, "Do guests need a Riverside account..."  
https://riverside.com/faq

### 2.6 Screen Share

Hosts and guests can share their screen while recording. Riverside states each screen share is recorded locally on its own track.

Source: Riverside FAQ, "Can I share my screen while recording?"  
https://riverside.com/faq

### 2.7 Crash and Network Resilience

Riverside positions local recording plus background upload as protection against internet issues and browser crashes. The intended user experience is that locally recorded files remain safe and can continue uploading or be recovered after disruption.

Source: Riverside FAQ, browser crash and local recording entries  
https://riverside.com/faq

### 2.8 Studios

Riverside uses the concept of a "studio" as a dedicated space for a show, channel, client, or production. A studio contains recordings, hosting/publishing settings, analytics, and related workspace organization.

Source: Riverside pricing FAQ, "What is a studio?"  
https://riverside.com/pricing

### 2.9 Studio Chat

Riverside mobile listing describes studio chat for sharing messages with participants during the session.

Source: Riverside Android listing  
https://play.google.com/store/apps/details?id=riverside.fm

### 2.10 Mobile And Multicam

Riverside has mobile apps. Its Android listing says users can record on mobile and use multicam mode to turn a phone into a secondary webcam for desktop.

Source: Riverside Android listing  
https://play.google.com/store/apps/details?id=riverside.fm

### 2.11 Text-Based Editing

Riverside's editor lets users edit recordings through the transcript. Public copy describes deleting a line or correcting a word in the transcript and having that applied to the video.

Source: Riverside video editor  
https://riverside.com/video-editor

### 2.12 Transcription

Riverside provides AI transcription in 100+ languages. It associates speakers using the separate tracks from each participant. If there is only a mixed track or multiple people on one mic, speaker separation is weaker.

Source: Riverside transcription page  
https://riverside.com/transcription

### 2.13 Magic Clips

Riverside's Magic Clips feature identifies highlights in a recording and turns them into short, shareable clips. It supports social presets such as vertical, widescreen, and other aspect ratios; captions; branding; and export/share flows.

Source: Riverside Magic Clips  
https://riverside.com/magic-clips

### 2.14 Teleprompter

Riverside includes a built-in teleprompter where users can prepare notes, points, questions, or scripts inside the studio, then play, pause, pace, and replay the script while recording.

Source: Riverside teleprompter  
https://riverside.com/teleprompter

### 2.15 Live Streaming

Riverside paid plans include live streaming capabilities, including full HD live streaming, multistreaming to platforms such as YouTube, Facebook, LinkedIn, X, Twitch, and custom RTMP.

Source: Riverside pricing  
https://riverside.com/pricing

## 3. Core Product Model

### 3.1 Entities

The application should be organized around these entities.

#### User

A registered account holder. Usually a host, editor, producer, or workspace admin.

Required fields:

- id
- name
- email
- avatar_url
- created_at
- updated_at

#### Workspace

A team or account boundary. A workspace owns studios, users, billing/configuration, and storage.

Required fields:

- id
- name
- owner_user_id
- created_at
- updated_at

#### Studio

A persistent recording space for a show, client, podcast, channel, or production.

Required fields:

- id
- workspace_id
- name
- slug
- default_language
- default_recording_quality
- branding_settings
- created_at
- updated_at

#### Session

A single recording event inside a studio.

Required fields:

- id
- studio_id
- title
- status: scheduled | lobby | live | recording | stopping | processing | ready | failed
- scheduled_at
- started_at
- recording_started_at
- recording_stopped_at
- ended_at
- created_by_user_id
- created_at
- updated_at

#### Participant

A person who joins a session.

Required fields:

- id
- session_id
- user_id nullable
- display_name
- role: host | guest | producer | audience
- join_token
- device_label_summary
- joined_at
- left_at
- connection_status
- upload_status

#### Track

A recorded media stream belonging to a participant or screen share.

Required fields:

- id
- session_id
- participant_id nullable for system/generated tracks
- type: camera_video | microphone_audio | screen_video | screen_audio | mixed_export | transcript | clip
- source_kind: local_recording | server_egress | generated_export | uploaded_file
- status: pending | recording | uploading | uploaded | processing | ready | failed
- mime_type
- codec
- duration_ms
- width
- height
- frame_rate
- sample_rate
- channel_count
- storage_key
- size_bytes
- started_at
- ended_at
- created_at
- updated_at

#### UploadChunk

A piece of a locally recorded track uploaded from a client.

Required fields:

- id
- track_id
- participant_id
- chunk_index
- offset_bytes
- size_bytes
- duration_ms
- checksum
- storage_key
- status: queued | uploading | uploaded | verified | failed
- created_at
- uploaded_at

#### Transcript

Speech-to-text output for a session or track.

Required fields:

- id
- session_id
- language
- status
- provider
- text
- words_json
- segments_json
- created_at
- updated_at

#### EditDecisionList

Non-destructive editing instructions.

Required fields:

- id
- session_id
- version
- timeline_json
- layout_json
- transcript_edits_json
- created_by_user_id
- created_at
- updated_at

#### Export

A generated file such as a mixed video, audio-only file, transcript, captions, or social clip.

Required fields:

- id
- session_id
- type: full_mix_video | full_mix_audio | participant_track | screen_track | captions | transcript | clip
- status: queued | processing | ready | failed
- format
- storage_key
- size_bytes
- duration_ms
- created_at
- updated_at

## 4. Core User Roles

### 4.1 Host

The host owns or controls the session.

Host capabilities:

- Create studio.
- Create session.
- Invite guests.
- Admit participants if waiting room is enabled.
- Select own devices.
- Start and stop recording.
- Enable or disable participant recording.
- Request participants to mute/unmute.
- Start screen share.
- View upload progress.
- End session.
- Access dashboard after session.
- Download tracks and exports.
- Trigger processing, transcription, and export jobs.

### 4.2 Guest

A guest joins by invite link, usually without an account.

Guest capabilities:

- Enter display name.
- Grant camera/microphone permissions.
- Select camera, microphone, and speaker.
- Join lobby.
- Join studio.
- Participate in live call.
- Be locally recorded.
- Share screen if permitted.
- See local upload status.
- Stay on the upload/recovery screen until upload completes.

### 4.3 Producer

A producer assists with recording but may not appear in final media.

MVP note: Producer mode can be deferred. If included, producer should join the live room without being locally recorded by default.

Producer capabilities:

- Join session.
- Monitor participants.
- Chat with host/guests.
- Observe upload health.
- Potentially control guest inputs/outputs in advanced versions.

### 4.4 Audience

Audience members can watch live but are not recorded.

MVP note: Defer audience mode unless live webinar functionality is required.

## 5. Core User Flows

### 5.1 Host Creates Studio

Flow:

1. Host signs in.
2. Host creates workspace or uses existing workspace.
3. Host creates studio with name, language, default quality, and optional branding.
4. App creates a persistent studio URL/slug.

Acceptance criteria:

- Studio appears in dashboard.
- Studio can contain multiple sessions.
- Studio settings can be reused for future sessions.

### 5.2 Host Creates Recording Session

Flow:

1. Host opens a studio.
2. Host clicks create/new recording.
3. App creates a session.
4. App generates host link and guest invite link.
5. Host can copy invite link.

Acceptance criteria:

- Session exists before guests join.
- Invite link can be opened without guest auth.
- Session has status lobby or scheduled before live start.

### 5.3 Guest Join Through Invite Link

Flow:

1. Guest opens invite link.
2. Guest lands in pre-join lobby.
3. Guest enters name.
4. Browser asks permission for camera and microphone.
5. Guest selects devices.
6. Guest sees local preview.
7. Guest joins studio.

Acceptance criteria:

- Guest does not need an account.
- Guest cannot access other sessions.
- Device permission failures have clear recovery states.
- Guest can join with audio-only if camera is unavailable or disabled.

### 5.4 Device Check

Flow:

1. App lists available cameras, microphones, and speakers where browser support allows.
2. User selects devices.
3. App shows camera preview.
4. App shows microphone level meter.
5. App stores selected device ids for the session.

Acceptance criteria:

- User can change devices before joining.
- User can change devices during the session.
- App handles device disconnects gracefully.

### 5.5 Live Studio

Flow:

1. Host and guests join a live room.
2. Participants see/hear each other in real time.
3. App displays participant tiles, names, mute state, recording status, and upload status.
4. Participants can mute/unmute mic and enable/disable camera.
5. Host can start recording.

Acceptance criteria:

- Live call remains usable at normal network conditions.
- Live call quality can degrade independently of local recording quality.
- Participant tiles do not represent final recording quality; final media comes from local tracks.

### 5.6 Start Recording

Flow:

1. Host clicks Record.
2. Server validates host permission.
3. Server creates recording start event with authoritative timestamp.
4. Server broadcasts start event to participants.
5. Each client starts local recording for available sources.
6. Each client creates local track records and begins chunking.
7. Each client uploads chunks in the background.
8. UI shows recording state and upload health.

Acceptance criteria:

- All participants receive the same session recording start event.
- Every local track records from the participant's own device.
- If upload is slow, recording continues locally.
- If network disconnects, local recording should continue where browser/platform allows.
- Participants are warned not to close the tab while upload is incomplete.

### 5.7 Stop Recording

Flow:

1. Host clicks Stop.
2. Server validates host permission.
3. Server broadcasts stop event.
4. Each client stops local MediaRecorder/recording pipeline.
5. Each client flushes final chunks.
6. Each client finalizes local manifest.
7. Upload continues until all chunks are uploaded and verified.
8. Server marks session processing once all required uploads complete or timeout rules trigger.

Acceptance criteria:

- Final chunks are uploaded.
- UI distinguishes recording stopped from upload complete.
- Host can see which participants are still uploading.
- Guest sees a post-recording upload screen if upload is incomplete.

### 5.8 Upload Recovery

Flow:

1. Client stores recording chunks and track manifest locally while recording.
2. Client uploads chunks in sequence or resumable protocol.
3. If upload fails, chunks remain queued locally.
4. When connection returns, upload resumes from last verified offset/chunk.
5. If user closes tab early, app attempts recovery when they reopen the session link from the same browser/device.

Acceptance criteria:

- Upload status survives page refresh when browser storage remains available.
- Already uploaded chunks are not duplicated.
- Server can verify chunk ordering and integrity.
- User has clear "upload incomplete" messaging.
- Host dashboard shows incomplete or missing tracks.

### 5.9 Screen Share Recording

Flow:

1. Participant clicks screen share.
2. Browser prompts for display/window/tab permission.
3. Screen share is sent to live room.
4. If session is recording, screen share is recorded as its own local track.
5. Screen share upload follows same chunk/resume flow as camera/mic tracks.
6. When screen share stops, its track is finalized.

Acceptance criteria:

- Screen share is tracked separately from participant camera.
- Screen share can start/stop during recording.
- Screen share track has its own timeline offset.
- Browser limitations around system audio are handled explicitly.

### 5.10 Post-Session Processing

Flow:

1. Server waits for required tracks or timeout.
2. Worker verifies chunks.
3. Worker assembles chunks into raw track files.
4. Worker probes track metadata.
5. Worker aligns tracks by start timestamps/timeline offsets.
6. Worker generates preview files.
7. Worker optionally generates mixed video/audio export.
8. Worker optionally sends audio to transcription.
9. Session becomes ready.

Acceptance criteria:

- Separate tracks are downloadable.
- Mixed export is available.
- Track durations and offsets are visible to the editor.
- Processing failures are per-track where possible, not entire-session fatal.

### 5.11 Dashboard

Flow:

1. Host opens dashboard.
2. Host sees studios.
3. Host opens a studio.
4. Host sees sessions/recordings.
5. Host opens session detail.
6. Host sees participants, tracks, upload status, exports, transcript, and actions.

Acceptance criteria:

- Host can download individual participant tracks.
- Host can download mixed export.
- Host can see whether any recording is still uploading.
- Host can retry failed processing jobs.
- Host can delete a session or track according to permissions.

### 5.12 Basic Editor

Flow:

1. Host opens a ready session.
2. Editor loads media proxies and transcript if available.
3. Host can play synchronized tracks.
4. Host can select layout.
5. Host can trim beginning/end.
6. Host can cut ranges from timeline.
7. Host can export the result.

MVP editor scope:

- Timeline playback.
- Speaker/video layout selection.
- Trim and simple cuts.
- Export full mix.

Deferred editor scope:

- Full transcript-based editing.
- Filler word removal.
- Silence removal.
- AI speech correction.
- Collaborative editing.
- Non-destructive timeline export formats.

### 5.13 Transcription

Flow:

1. Worker extracts or uses participant audio tracks.
2. Transcription job runs.
3. Transcript segments are associated with participant/speaker where possible.
4. Transcript appears in session editor.
5. User can download transcript and captions.

Acceptance criteria:

- Transcript can be generated from separate participant audio tracks.
- Speaker labels map to participant names when tracks are separate.
- Output supports at least TXT, SRT, and VTT.

### 5.14 Clip Creation

Flow:

1. User selects a range manually or AI proposes ranges.
2. User chooses aspect ratio: 16:9, 1:1, or 9:16.
3. User chooses layout and caption style.
4. Worker renders clip.
5. User downloads clip.

MVP scope:

- Manual clip selection.
- 9:16, 1:1, and 16:9 exports.
- Burned-in captions if transcript exists.

Deferred scope:

- AI highlight detection.
- Branded presets.
- Auto titles/headlines.
- Social scheduling.

## 6. Recording Architecture Requirements

This section is a recommended independent implementation, not a claim about Riverside internals.

### 6.1 Separation Of Live Call And Final Recording

The live call and final recording should be separate systems.

Live call:

- Optimized for low latency.
- Can reduce quality under poor network conditions.
- Uses WebRTC.
- Provides conversation, monitoring, and presence.

Final recording:

- Captured locally from original media devices.
- Uses higher local constraints where possible.
- Stores chunks locally before/during upload.
- Uploads independently from live WebRTC quality.
- Produces final downloadable files.

### 6.2 Client-Side Recording Sources

Required recording sources:

- Microphone audio.
- Camera video.
- Screen video.

Optional recording sources:

- System/tab audio from screen capture, browser permitting.
- Separate raw PCM audio via AudioWorklet for WAV-grade exports.
- Multiple local camera inputs.

### 6.3 Browser APIs

Recommended browser APIs:

- `navigator.mediaDevices.getUserMedia()` for camera and microphone.
- `navigator.mediaDevices.enumerateDevices()` for device picker.
- `navigator.mediaDevices.getDisplayMedia()` for screen share.
- `MediaRecorder` for MVP chunked media recording.
- IndexedDB or Origin Private File System for local chunk persistence.
- Web Locks or BroadcastChannel to avoid duplicate recovery uploads from multiple tabs.

References:

- getUserMedia: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
- getDisplayMedia: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia
- MediaRecorder start: https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/start
- MediaRecorder dataavailable: https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/dataavailable_event

### 6.4 MediaRecorder MVP

The MVP should use `MediaRecorder` because it is available in modern browsers and can emit periodic Blob chunks.

Recommended behavior:

- Detect supported MIME types at runtime.
- Prefer video WebM with VP9/VP8 and Opus where supported.
- Fall back to browser-supported MP4/H.264/AAC where available.
- Record audio-only if camera recording fails.
- Use a short chunk interval, for example 2 to 5 seconds.
- Store each chunk before marking it uploadable.
- Maintain a client-side track manifest.

Important limitation:

Browser `MediaRecorder` does not guarantee true uncompressed WAV capture. Riverside claims 48kHz WAV. To match that later, add a separate audio pipeline using Web Audio/AudioWorklet to capture PCM and encode WAV/FLAC server-side or client-side.

### 6.5 Local Track Manifest

Each client should maintain a manifest like:

```json
{
  "sessionId": "sess_123",
  "participantId": "part_123",
  "trackId": "track_123",
  "source": "camera_video",
  "mimeType": "video/webm;codecs=vp8,opus",
  "startedAt": "2026-07-01T20:00:00.000Z",
  "recordingStartPerfMs": 1250.44,
  "chunks": [
    {
      "index": 0,
      "localKey": "chunk_0",
      "durationMs": 5000,
      "sizeBytes": 1234567,
      "sha256": "..."
    }
  ]
}
```

Manifest requirements:

- Track id generated before first chunk upload.
- Chunks ordered monotonically.
- Chunk checksums stored.
- MIME type and codec stored.
- Local start time and server recording event id stored.
- Upload completion tracked per chunk.

### 6.6 Synchronization

The system needs enough timing metadata to align independently recorded tracks.

Recommended sync model:

- Server emits authoritative `recording_started` event with server timestamp and monotonic event id.
- Each client records local wall-clock receipt time.
- Each client records local performance timer at actual recorder start.
- Each chunk stores index and approximate duration.
- Server aligns tracks by recording start event plus per-track actual start offset.

Optional sync improvements:

- Pre-roll buffer before host starts recording.
- Periodic sync pings estimating server/client clock offset.
- Clap/sync marker button.
- Audio waveform alignment in processing worker.

### 6.7 Upload Pipeline

The upload system must be resilient. Large recording files should not rely on a single upload request.

Recommended options:

- tus resumable upload protocol.
- S3 multipart upload with presigned part URLs.

References:

- tus resumable uploads: https://tus.io/
- AWS S3 multipart uploads: https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html

MVP recommendation:

- Use S3-compatible object storage for chunks and assembled media.
- Use either tusd/tus-node-server or custom multipart upload endpoints.
- Store upload state in Postgres.
- Store binary chunks in S3/MinIO/R2.
- Use Redis queue for assembly/transcoding jobs.

### 6.8 Upload States

Client upload states:

- idle
- recording
- queued
- uploading
- caught_up
- delayed
- reconnecting
- finalizing
- complete
- failed

Server track states:

- pending
- recording
- upload_started
- upload_in_progress
- upload_complete
- verifying
- assembled
- processing
- ready
- failed
- abandoned

### 6.9 Recovery Rules

Required:

- Chunks must be saved locally before upload begins.
- Upload retry should use exponential backoff.
- Upload should resume after temporary offline state.
- Refreshing the page should not discard chunks.
- Reopening the invite/session link on the same browser should attempt recovery.

Useful but optional:

- "Recover recordings" page that scans local browser storage.
- Manual local download of incomplete recordings.
- Host warning when a participant leaves before upload completes.

## 7. Processing Pipeline

### 7.1 Worker Jobs

Required jobs:

- verify_uploaded_chunks
- assemble_track
- probe_track_metadata
- generate_preview_proxy
- generate_waveform
- transcode_downloadable_track
- create_mixed_export
- transcribe_audio
- generate_captions
- render_clip

### 7.2 Media Tooling

Recommended tools:

- FFmpeg for muxing, transcoding, layout rendering, clips, audio extraction.
- FFprobe for metadata.
- waveform generator library or FFmpeg filters for waveform data.
- Whisper/faster-whisper/WhisperX for open-source transcription.

### 7.3 Track Outputs

For each participant:

- Original uploaded track, if usable.
- Normalized downloadable track.
- Audio-only file.
- Optional WAV export.
- Low-resolution preview/proxy.

For session:

- Full mixed MP4.
- Full mixed audio.
- Transcript TXT.
- Captions SRT/VTT.
- Optional clips.

### 7.4 Layout Rendering

Initial layout templates:

- Solo speaker full frame.
- Grid layout.
- Two-person side-by-side.
- Speaker with guest inset.
- Screen share dominant with speaker inset.
- Vertical social layout.

Inputs:

- Track files.
- Timeline offsets.
- Layout selection.
- Trim/cut decisions.
- Captions.

Output:

- MP4 H.264/AAC for compatibility.

## 8. MVP Feature Prioritization

### 8.1 Must Have For First Open-Source Release

- Auth for hosts.
- Studio creation.
- Session creation.
- Guest invite link without guest account.
- Lobby with camera/mic picker.
- Live WebRTC room.
- Host start/stop recording.
- Local recording per participant.
- Separate participant track upload.
- Upload progress and recovery.
- Session dashboard.
- Download separate tracks.
- Basic mixed export.
- Docker Compose local development.
- README and setup docs.

### 8.2 Should Have Soon After MVP

- Screen share as separate recorded track.
- Studio chat.
- Audio-only mode.
- Basic transcript generation.
- SRT/VTT captions.
- Manual clips.
- Simple editor with trim/cut.
- Upload recovery page.
- Participant upload health dashboard.
- Basic role permissions.

### 8.3 Could Have Later

- True WAV/PCM recording pipeline.
- 4K recording presets.
- AI clip detection.
- Text-based editing.
- Filler word removal.
- Silence removal.
- Branding kit.
- Teleprompter.
- Producer mode.
- Audience mode.
- RTMP live streaming.
- Mobile apps.
- Multicam phone-as-webcam.
- Podcast hosting.
- Social scheduling.
- Collaborative editing.
- SSO and enterprise roles.

### 8.4 Explicitly Out Of Scope For MVP

- Copying Riverside's UI or brand.
- Native iOS/Android app.
- Guaranteed 4K across browsers.
- Guaranteed 48kHz WAV from browser MediaRecorder.
- AI eye contact correction.
- AI lip/speech correction.
- Full webinar registration system.
- Large-scale multi-region media infrastructure.

## 9. Recommended Open-Source Stack

### 9.1 Frontend

Recommended:

- Next.js
- React
- TypeScript
- Tailwind CSS
- shadcn/ui or similar accessible component primitives
- LiveKit client SDK

### 9.2 Realtime Media

Recommended:

- LiveKit OSS for WebRTC rooms.

Why:

- Open-source.
- Designed for multi-user WebRTC.
- Can be self-hosted.
- Has client SDKs.
- Has server-side room/token model.

References:

- LiveKit GitHub: https://github.com/livekit/livekit
- LiveKit self-hosting: https://docs.livekit.io/transport/self-hosting/

### 9.3 Backend

Recommended:

- Node.js with Fastify or NestJS.
- TypeScript.
- REST or tRPC for app API.
- WebSocket/SSE for app status events, if not handled through LiveKit data channels.

### 9.4 Database

Recommended:

- Postgres.
- Prisma or Drizzle ORM.

### 9.5 Queue And Jobs

Recommended:

- Redis.
- BullMQ or Temporal.

MVP choice:

- BullMQ is simpler for first release.
- Temporal is better for long-running, retry-heavy production workflows.

### 9.6 Storage

Recommended:

- S3-compatible object storage.
- MinIO for local development.
- Cloudflare R2, AWS S3, Backblaze B2, or another S3-compatible provider for production.

### 9.7 Uploads

Recommended:

- tus protocol via tusd/tus-node-server, or
- S3 multipart upload with presigned URLs.

For open-source self-hosting, tus plus S3-compatible storage is a good default because it gives a clear resumable upload abstraction.

### 9.8 Media Processing

Recommended:

- FFmpeg installed in worker image.
- FFprobe installed in worker image.
- Optional GPU worker class later for transcription or AI.

### 9.9 Transcription

Recommended:

- faster-whisper for local/open-source transcription.
- WhisperX if word-level alignment and diarization are important.
- Optional provider abstraction for hosted APIs.

### 9.10 Deployment

Minimum local services:

- web
- api
- worker
- postgres
- redis
- minio
- livekit
- optional tus server

Use Docker Compose for first release.

## 10. Suggested Monorepo Structure

```text
apps/
  web/
    src/
      app/
      components/
      features/
        lobby/
        studio/
        recorder/
        dashboard/
        editor/
      lib/
  api/
    src/
      routes/
      services/
      auth/
      livekit/
      uploads/
      sessions/
  worker/
    src/
      jobs/
      media/
      transcription/
      exports/
packages/
  db/
    prisma-or-drizzle-schema
  shared/
    types/
    events/
    validation/
  recorder-client/
    src/
      media-devices.ts
      local-recorder.ts
      chunk-store.ts
      upload-manager.ts
      recovery.ts
infra/
  docker-compose.yml
  livekit/
  minio/
docs/
  architecture.md
  recording-pipeline.md
  upload-recovery.md
  open-source-roadmap.md
```

## 11. API Surface Draft

### 11.1 Studios

```http
POST /api/studios
GET /api/studios
GET /api/studios/:studioId
PATCH /api/studios/:studioId
DELETE /api/studios/:studioId
```

### 11.2 Sessions

```http
POST /api/studios/:studioId/sessions
GET /api/studios/:studioId/sessions
GET /api/sessions/:sessionId
PATCH /api/sessions/:sessionId
POST /api/sessions/:sessionId/end
```

### 11.3 Invites

```http
POST /api/sessions/:sessionId/invites
GET /api/invites/:inviteToken
POST /api/invites/:inviteToken/join
```

### 11.4 Live Room Tokens

```http
POST /api/sessions/:sessionId/livekit-token
```

### 11.5 Recording Control

```http
POST /api/sessions/:sessionId/recording/start
POST /api/sessions/:sessionId/recording/stop
GET /api/sessions/:sessionId/recording/status
```

### 11.6 Tracks

```http
POST /api/sessions/:sessionId/tracks
GET /api/sessions/:sessionId/tracks
GET /api/tracks/:trackId
PATCH /api/tracks/:trackId
POST /api/tracks/:trackId/finalize
GET /api/tracks/:trackId/download-url
```

### 11.7 Uploads

If custom multipart:

```http
POST /api/tracks/:trackId/uploads
POST /api/uploads/:uploadId/parts
POST /api/uploads/:uploadId/complete
GET /api/uploads/:uploadId/status
```

If tus:

```http
POST /files
HEAD /files/:uploadId
PATCH /files/:uploadId
```

### 11.8 Processing

```http
POST /api/sessions/:sessionId/process
POST /api/sessions/:sessionId/transcribe
POST /api/sessions/:sessionId/exports
GET /api/sessions/:sessionId/exports
GET /api/exports/:exportId/download-url
```

## 12. Realtime Events

Events can travel over LiveKit data channels, WebSocket, or SSE.

### 12.1 Session Events

```json
{
  "type": "session.participant_joined",
  "sessionId": "sess_123",
  "participantId": "part_123",
  "at": "2026-07-01T20:00:00.000Z"
}
```

Event types:

- session.participant_joined
- session.participant_left
- session.participant_muted
- session.participant_unmuted
- session.screen_share_started
- session.screen_share_stopped
- session.chat_message_created

### 12.2 Recording Events

Event types:

- recording.start_requested
- recording.started
- recording.stop_requested
- recording.stopped
- recording.participant_started
- recording.participant_failed
- recording.track_created
- recording.track_finalized

### 12.3 Upload Events

Event types:

- upload.started
- upload.progress
- upload.delayed
- upload.resumed
- upload.complete
- upload.failed

### 12.4 Processing Events

Event types:

- processing.queued
- processing.started
- processing.track_ready
- processing.export_ready
- processing.transcript_ready
- processing.failed
- session.ready

## 13. UI Requirements

### 13.1 Host Dashboard

Must show:

- Studios list.
- Recent sessions.
- Create recording button.
- Session status.
- Processing status.
- Upload incomplete warnings.
- Download/export actions.

### 13.2 Studio Page

Must show:

- Studio name.
- New session button.
- Invite controls.
- Recordings list.
- Settings.

### 13.3 Lobby

Must show:

- Name input for guests.
- Camera preview.
- Microphone meter.
- Device selectors.
- Join button.
- Permission error states.
- Browser compatibility warnings.

### 13.4 Live Studio Room

Must show:

- Participant tiles.
- Host controls.
- Mute/camera controls.
- Record button for host.
- Recording timer.
- Upload status.
- Screen share button.
- Chat panel.
- Leave button.

### 13.5 Upload Completion Screen

Must show:

- "Recording stopped" state.
- Current upload progress.
- Warning not to close tab.
- Recovery instructions if upload fails.
- Done state when upload completes.

### 13.6 Session Detail

Must show:

- Participants.
- Tracks by participant.
- Track statuses.
- Download buttons.
- Mixed export.
- Transcript/caption downloads.
- Processing retry controls.

### 13.7 Editor MVP

Must show:

- Video preview.
- Timeline.
- Participant tracks.
- Basic trim/cut controls.
- Layout selector.
- Export button.

## 14. Browser And Platform Constraints

### 14.1 Permissions

Camera and microphone access requires user permission. Browsers must show permission prompts and indicators.

### 14.2 Secure Context

Camera/mic and screen APIs require HTTPS in production. Localhost is generally treated as secure for development.

### 14.3 Screen Share Permission

Screen sharing requires a fresh user prompt. The browser does not allow apps to silently start screen capture.

### 14.4 Browser Codec Differences

Different browsers support different MediaRecorder MIME types and codecs. The recorder must test support at runtime.

### 14.5 Timeslice Accuracy

MediaRecorder chunk intervals are not exact. Do not use chunk count alone as the source of truth for elapsed time. Store timestamps and durations.

Reference:  
https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/dataavailable_event

### 14.6 Resource Exhaustion

High-resolution recording can exhaust browser/device resources. The app needs quality presets and fallback behavior.

Reference:  
https://www.w3.org/TR/mediastream-recording/

## 15. Quality Settings

### 15.1 MVP Presets

Audio-only:

- microphone only
- good for low bandwidth or camera failure

Standard:

- 720p target
- 30fps target
- Opus audio

High:

- 1080p target
- 30fps target
- higher video bitrate

Experimental Pro:

- 4K target where supported
- high bitrate
- device capability checks

### 15.2 Audio

MVP:

- Record audio through MediaRecorder.
- Export audio from media file with FFmpeg.
- Normalize loudness in processing.

Future:

- Capture PCM with AudioWorklet.
- Generate true WAV files.
- Optional noise reduction.
- Optional separate mic channels if device/browser exposes them.

## 16. Security And Privacy

Required:

- Signed invite tokens.
- Scoped guest access.
- Authenticated host dashboard.
- Private object storage by default.
- Short-lived signed download URLs.
- Server-side permission checks for all session, track, and export access.
- Clear consent that participants are being recorded.
- Recording indicator visible during recording.
- Delete session/media capability.

Recommended:

- Encrypt storage at rest where provider supports it.
- Audit log for recording start/stop and downloads.
- Configurable retention.
- Workspace-level access controls.

## 17. Open-Source Release Requirements

Repository should include:

- README.md
- LICENSE
- CONTRIBUTING.md
- CODE_OF_CONDUCT.md
- SECURITY.md
- .env.example
- Docker Compose setup
- Seed/dev script
- Architecture docs
- Recording pipeline docs
- Upload recovery docs
- Public roadmap
- Issue templates
- PR template

Recommended license:

- AGPL-3.0 if the goal is to keep hosted modifications open.
- Apache-2.0 if the goal is maximum adoption and commercial friendliness.

Do not:

- Use the Riverside name in the project name.
- Use Riverside logos, colors, copy, screenshots, or UI clones.
- Claim compatibility or partnership unless true.

## 18. Definition Of Done For MVP

An MVP release is ready when:

- A developer can run the full stack locally with one documented command.
- A host can create a studio and recording session.
- A guest can join with an invite link without an account.
- Host and guest can see/hear each other in a live room.
- Host can start and stop recording.
- Each participant records locally.
- Each participant uploads separate tracks.
- Upload survives temporary network interruption.
- Host can see upload progress.
- Host can download separate tracks after processing.
- Host can generate and download a basic mixed MP4.
- The project has clear open-source setup and contribution docs.

## 19. Biggest Technical Risks

### 19.1 Local Recording Reliability

Browsers can pause, throttle, or lose access to devices in edge cases. The app needs robust error handling, local persistence, and recovery flows.

### 19.2 Upload Recovery

Large video chunks over weak networks are the hardest operational part. Use resumable uploads from the start.

### 19.3 Cross-Browser Codec Support

Chrome, Safari, Firefox, and mobile browsers differ. Runtime feature detection is mandatory.

### 19.4 True WAV Audio

Riverside claims 48kHz WAV. Browser MediaRecorder will not reliably provide uncompressed WAV. Treat true WAV as a separate advanced audio pipeline.

### 19.5 Track Synchronization

Separate local recordings will drift or start at slightly different times. Store timing metadata and plan for waveform-based correction later.

### 19.6 Processing Cost

Video transcoding and transcription are CPU/GPU intensive. Use queues and make processing asynchronous.

## 20. First Implementation Milestones

### Milestone 1: Skeleton

- Monorepo.
- Docker Compose.
- Auth.
- Postgres schema.
- Studio/session CRUD.

### Milestone 2: Live Room

- LiveKit server.
- Token generation.
- Lobby.
- Live room UI.
- Mute/camera controls.

### Milestone 3: Local Recording

- Media device selection.
- Local recorder package.
- Chunk generation.
- Local chunk persistence.
- Track manifest.

### Milestone 4: Uploads

- Resumable upload endpoint.
- Upload manager.
- Upload progress UI.
- Recovery after refresh.

### Milestone 5: Processing

- Assemble chunks.
- Probe media.
- Generate downloadable tracks.
- Generate mixed MP4.

### Milestone 6: Dashboard

- Session detail.
- Track list.
- Processing status.
- Downloads.

### Milestone 7: Public Release Polish

- README.
- Docs.
- Tests.
- Example env.
- Demo script.
- Security notes.
- License.

## 21. Source Links

Primary Riverside sources:

- Riverside FAQ: https://riverside.com/faq
- Riverside pricing: https://riverside.com/pricing
- Riverside homepage: https://riverside.com/
- Riverside video editor: https://riverside.com/video-editor
- Riverside transcription: https://riverside.com/transcription
- Riverside Magic Clips: https://riverside.com/magic-clips
- Riverside teleprompter: https://riverside.com/teleprompter
- Riverside Android listing: https://play.google.com/store/apps/details?id=riverside.fm

Implementation references:

- LiveKit GitHub: https://github.com/livekit/livekit
- LiveKit self-hosting: https://docs.livekit.io/transport/self-hosting/
- LiveKit egress: https://docs.livekit.io/transport/media/ingress-egress/egress/
- MDN getUserMedia: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
- MDN getDisplayMedia: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia
- MDN MediaRecorder start: https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/start
- MDN MediaRecorder dataavailable: https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/dataavailable_event
- W3C MediaStream Recording: https://www.w3.org/TR/mediastream-recording/
- tus resumable uploads: https://tus.io/
- AWS S3 multipart uploads: https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html

