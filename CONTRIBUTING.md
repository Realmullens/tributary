# Contributing to Tributary

Thanks for your interest! Tributary is a self-hostable remote recording studio;
the bar for changes is that recordings must never get less safe.

## Getting started

```bash
pnpm install
pnpm dev          # server on :4100, web on :4110
```

Requirements: Node 20+, pnpm, ffmpeg/ffprobe on PATH. Optional: whisper.cpp
(`brew install whisper-cpp`) for transcription. See `.env.example` for all
configuration knobs — none are required for local development.

## Before you open a PR

- `pnpm typecheck` must pass (CI runs it plus a web build).
- Exercise the flow you touched in a real browser — recording, upload
  resilience, and reconnection behavior are the heart of the project and are
  easy to regress in ways typecheck can't catch. Chromium's
  `--use-fake-device-for-media-stream` flag works well for camera-less
  testing.
- Keep PRs focused; UI-only and behavior changes are easier to review apart.

## Ground rules for the recording path

- Every chunk is written to IndexedDB **before** upload; uploads are
  idempotent by (track, chunk index) and must stay resumable after a crash,
  refresh, or network loss.
- Live-call quality and recording quality are decoupled — don't couple them.
- Server-side processing must treat client media as untrusted input.

## Reporting bugs / security issues

Open a GitHub issue with reproduction steps. For anything security-sensitive
(auth bypass, media access across sessions), please use GitHub's private
security advisory feature instead of a public issue.
