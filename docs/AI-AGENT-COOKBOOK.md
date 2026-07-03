# AI Agent Cookbook

This cookbook shows how to drive the `tributary` CLI from Claude Code, Codex, or
another agent after you have a recorded episode. Each recipe includes the prompt
to give the agent and the raw CLI commands the agent should end up running.

The examples use shell variables so you can paste the commands after replacing
the IDs with values from your own Tributary server.

## Find the Recording

```bash
tributary studios > /tmp/tributary-studios.json

export STUDIO_ID="studio_123"
tributary sessions "$STUDIO_ID" > /tmp/tributary-sessions.json

export SESSION_ID="session_123"
tributary session "$SESSION_ID" > /tmp/tributary-session.json

export RECORDING_ID="recording_123"
tributary transcribe "$RECORDING_ID" --wait
```

Use `tributary session "$SESSION_ID"` to find the recording ID, track IDs, export
IDs, transcript status, and previous renders. All command output is JSON, so an
agent can parse it directly.

## Recipe 1: Remove Filler Words

Use this when you want a cleaner full episode while preserving the original
timeline everywhere except the removed filler words.

### Prompt

```text
You are editing a Tributary recording.

Goal: remove distracting standalone filler words from RECORDING_ID.

Use the Tributary CLI. Fetch word-level timestamps, find standalone "um", "uh",
"erm", and "like" tokens, and create cut ranges in milliseconds. Pad each cut by
30 ms on both sides, merge overlapping cuts, and do not cut if the surrounding
words would become confusing. Show me the final tributary export command before
you render.
```

### Commands

```bash
tributary words "$RECORDING_ID" > /tmp/tributary-words.json
```

Example word entries the agent is looking for:

```json
{
  "words": [
    { "startMs": 4210, "endMs": 4340, "text": "Um", "speaker": "host" },
    { "startMs": 18730, "endMs": 18890, "text": "like", "speaker": "guest" },
    { "startMs": 41200, "endMs": 41480, "text": "uh", "speaker": "host" }
  ]
}
```

After padding by 30 ms, the render command becomes:

```bash
tributary export "$RECORDING_ID" \
  --cut 4180-4370 \
  --cut 18700-18920 \
  --cut 41170-41510 \
  --wait \
  -o episode-clean.mp4
```

If you also need a cleaned audio-only master:

```bash
tributary export "$RECORDING_ID" \
  --audio \
  --cut 4180-4370 \
  --cut 18700-18920 \
  --cut 41170-41510 \
  --wait \
  -o episode-clean.wav
```

## Recipe 2: Create Three Vertical Highlight Clips

Use this when you want Shorts/Reels/TikTok clips with captions from one long
episode.

### Prompt

```text
You are an AI producer for a Tributary podcast episode.

Goal: choose three self-contained 30-60 second highlight clips from RECORDING_ID.

Use the transcript to find moments with a clear hook, useful payoff, and no
private information. Prefer clips that start on a complete sentence. Render each
clip as 9:16 with captions. Name the files clip-01.mp4, clip-02.mp4, and
clip-03.mp4. Also save a short notes file with the title and why each moment was
chosen.
```

### Commands

```bash
mkdir -p clips

tributary transcript "$RECORDING_ID" --format txt -o /tmp/tributary-episode.txt
tributary transcript "$RECORDING_ID" > /tmp/tributary-transcript.json
```

After reading the transcript, the agent picks timestamp ranges:

```bash
tributary export "$RECORDING_ID" \
  --trim-start 812400 \
  --trim-end 867200 \
  --aspect 9:16 \
  --captions \
  --wait \
  -o clips/clip-01.mp4

tributary export "$RECORDING_ID" \
  --trim-start 1320100 \
  --trim-end 1368800 \
  --aspect 9:16 \
  --captions \
  --wait \
  -o clips/clip-02.mp4

tributary export "$RECORDING_ID" \
  --trim-start 2215400 \
  --trim-end 2269000 \
  --aspect 9:16 \
  --captions \
  --wait \
  -o clips/clip-03.mp4
```

When captions are available, each command downloads an `.srt` sidecar next to the
MP4. Burned-in captions depend on the server ffmpeg build having libass.

## Recipe 3: Write Show Notes and Chapters

Use this when you want publishing copy without rendering any new media.

### Prompt

```text
You are preparing podcast show notes from a Tributary transcript.

Goal: write a concise episode summary, 5-8 bullet highlights, chapter markers,
and 3 title options for RECORDING_ID.

Use the transcript text for readability and the JSON transcript for millisecond
timestamps. Chapter markers should use HH:MM:SS and should point to topic
changes, not every speaker turn. Do not invent links or claims that are not in
the transcript.
```

### Commands

```bash
tributary transcript "$RECORDING_ID" --format txt -o show-notes-source.txt
tributary transcript "$RECORDING_ID" > show-notes-source.json
```

The agent then writes a Markdown file from those inputs:

```md
# Show Notes

## Summary
...

## Highlights
- ...

## Chapters
- 00:00 - Cold open and guest introduction
- 03:42 - Why local recording matters
- 12:18 - Upload recovery and crash safety
- 24:05 - Text-based editing workflow
- 38:44 - Deployment notes and next steps

## Title Options
1. ...
2. ...
3. ...
```

If you want chapter timing to line up with exported media that trims dead air,
render the episode first and subtract the same `--trim-start` value from each
chapter timestamp.

## Safety Checks for Agents

- Always inspect the transcript before rendering media.
- Keep all times in milliseconds until the final human-facing notes.
- Prefer sentence boundaries for `--trim-start` and `--trim-end`.
- Pad word-level filler cuts by a small amount, then merge overlaps.
- Use `--wait -o <file>` when the next step depends on the rendered file.
- Do not delete original recordings or tracks; Tributary exports are
  non-destructive.
