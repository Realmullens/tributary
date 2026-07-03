# Driving Tributary with AI agents

Tributary deliberately ships **no built-in AI post-production**. Instead, the `tributary` CLI
exposes the primitives — transcripts, word-level timestamps, cuts, aspect presets, captions —
so *any* agent (Claude Code, Codex, a cron script) can be the AI layer. The agent supplies the
judgment; Tributary supplies deterministic rendering.

## Setup

```bash
chmod +x cli/tributary.mjs
ln -s "$(pwd)/cli/tributary.mjs" /usr/local/bin/tributary   # or add cli/ to PATH
tributary login --email you@example.com --password '…' --server http://localhost:4100
```

Credentials land in `~/.tributary.json`. `TRIBUTARY_SERVER` / `TRIBUTARY_TOKEN` env vars
override it (useful for CI or a second server). Every command prints JSON.

## The core loop

```bash
tributary studios                          # find the studio
tributary sessions <studioId>              # find the session
tributary session <sessionId>              # recordings, tracks, exports, transcripts
tributary transcribe <recordingId> --wait  # whisper (idempotent; re-runs replace)
tributary transcript <recordingId>         # segments with speaker + ms timestamps
tributary words <recordingId>              # word-level timing for precise cuts
tributary export <recordingId> [edits…] --wait -o out.mp4
```

**All times are milliseconds on the recording timeline** — the same timebase across
transcript segments, words, and export edit parameters. What you read is what you cut.

## Recipes

For fuller, copy-pasteable examples with agent prompts and the raw CLI commands
they should produce, see [`AI-AGENT-COOKBOOK.md`](AI-AGENT-COOKBOOK.md).

**Highlight clip for Shorts/Reels** — read the transcript, pick the best 45–60s span,
render vertical with captions:

```bash
tributary transcript rec123
# … agent decides the highlight runs 812400–867200ms …
tributary export rec123 --trim-start 812400 --trim-end 867200 \
  --aspect 9:16 --captions --wait -o highlight.mp4
# → highlight.mp4 + highlight.srt (captions re-timed to the clip)
```

**Filler-word removal** — fetch words, find "um"/"uh"/"like" tokens, cut each:

```bash
tributary words rec123        # [{startMs, endMs, text, speaker}, …]
# … agent collects filler word ranges …
tributary export rec123 --cut 4210-4460 --cut 18730-18960 --cut 41200-41510 --wait -o clean.mp4
```

Cuts are removed ranges; they can be combined freely with trim and aspect. Overlapping or
out-of-order cuts are merged server-side.

**Show notes / episode summary** — pure reading:

```bash
tributary transcript rec123 --format txt -o episode.txt
# … agent writes summary, chapters, titles from the text …
```

**Full episode assembly** — trim dead air at both ends, cut the retake, master audio:

```bash
tributary export rec123 --trim-start 15000 --trim-end 3541000 --cut 1204000-1287000 --wait -o episode.mp4
tributary export rec123 --audio --trim-start 15000 --trim-end 3541000 --cut 1204000-1287000 --wait -o episode.wav
```

**Hand off to a human editor** — per-participant files plus a synced timeline:

```bash
tributary session sess1            # list track ids
tributary download-track t1 -o host-camera.mp4
tributary download-track t2 --kind wav -o guest-audio.wav
tributary xml rec123 -o timeline.xml   # opens in Premiere/Resolve with offsets applied
```

## Notes for agents

- `export --wait -o file` blocks until rendered and downloads in one step; without `--wait`
  it returns an `exportId` you can poll via `tributary session <sessionId>`.
- Caption burn-in only happens when the server's ffmpeg has libass; the `.srt` sidecar is
  always produced and downloaded next to your `-o` file.
- Transcription speaker labels come from the separate per-participant tracks, so
  `speaker` fields are reliable — no diarization guesswork.
- Word timestamps come from whisper tokens; treat boundaries as ±50ms and pad cuts slightly
  (e.g. 30ms) to avoid clipping syllables.
