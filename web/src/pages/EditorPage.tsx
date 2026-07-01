import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type Track, type TranscriptSegment, type TranscriptWord } from "../lib/api";
import { Badge, Button, Select, formatDuration } from "../components/ui";

type EditorData = {
  recording: { id: string; session_id: string; session_title: string; started_at_ms: number };
  tracks: Track[];
  transcriptSegments: TranscriptSegment[] | null;
  transcriptWords: TranscriptWord[] | null;
};

type Cut = { startMs: number; endMs: number };

/**
 * Editor MVP: synced multi-track preview + trim/cut edit decision list.
 * Edits are non-destructive — they're rendered server-side into a new export.
 */
export function EditorPage() {
  const { recordingId } = useParams<{ recordingId: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<EditorData | null>(null);
  const [playheadMs, setPlayheadMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [trimStartMs, setTrimStartMs] = useState(0);
  const [trimEndMs, setTrimEndMs] = useState<number | null>(null);
  const [cuts, setCuts] = useState<Cut[]>([]);
  const [pendingCutStart, setPendingCutStart] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [aspect, setAspect] = useState("16:9");
  const [captions, setCaptions] = useState(false);
  const [wordAnchor, setWordAnchor] = useState<number | null>(null);
  const [wordSelEnd, setWordSelEnd] = useState<number | null>(null);

  const mediaRefs = useRef(new Map<string, HTMLVideoElement | HTMLAudioElement>());
  const playheadRef = useRef(0);
  const playingRef = useRef(false);
  const timelineRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<EditorData>(`/api/recordings/${recordingId}`).then(setData);
  }, [recordingId]);

  const readyTracks = useMemo(
    () => (data?.tracks ?? []).filter((t) => t.status === "ready" && t.duration_ms),
    [data]
  );
  const videoTracks = readyTracks.filter((t) => t.width !== null);
  // Audio for participants without video comes from their WAV.
  const audioOnlyTracks = readyTracks.filter(
    (t) =>
      t.width === null &&
      t.type !== "screen" &&
      !videoTracks.some((v) => v.participant_id === t.participant_id)
  );
  const durationMs = useMemo(
    () =>
      Math.max(
        0,
        ...readyTracks.map((t) => Math.max(0, t.start_offset_ms) + (t.duration_ms ?? 0))
      ),
    [readyTracks]
  );
  const effectiveTrimEnd = trimEndMs ?? durationMs;

  const seek = useCallback((ms: number, clampToTrim = false) => {
    const target = Math.max(0, Math.min(ms, playheadRef.current === ms ? ms : ms));
    playheadRef.current = clampToTrim ? Math.max(0, target) : target;
    setPlayheadMs(playheadRef.current);
  }, []);

  // Master clock: advance the playhead, keep every media element in sync,
  // hop over cut ranges, stop at trim end.
  useEffect(() => {
    playingRef.current = playing;
    let raf = 0;
    let lastTs = 0;
    const tick = (ts: number) => {
      if (lastTs && playingRef.current) {
        let next = playheadRef.current + (ts - lastTs);
        for (const cut of cuts) {
          if (next >= cut.startMs && next < cut.endMs) next = cut.endMs;
        }
        if (next >= effectiveTrimEnd) {
          next = effectiveTrimEnd;
          playingRef.current = false;
          setPlaying(false);
        }
        playheadRef.current = next;
        setPlayheadMs(next);
      }
      lastTs = ts;

      for (const track of [...videoTracks, ...audioOnlyTracks]) {
        const el = mediaRefs.current.get(track.id);
        if (!el) continue;
        const local = (playheadRef.current - Math.max(0, track.start_offset_ms)) / 1000;
        const active =
          playingRef.current && local >= 0 && local < (track.duration_ms ?? 0) / 1000;
        if (Math.abs(el.currentTime - Math.max(0, local)) > 0.3) {
          el.currentTime = Math.max(0, Math.min(local, (track.duration_ms ?? 0) / 1000));
        }
        if (active && el.paused) void el.play().catch(() => {});
        if (!active && !el.paused) el.pause();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, cuts, effectiveTrimEnd, videoTracks, audioOnlyTracks]);

  const timelineClick = (e: React.MouseEvent) => {
    const rect = timelineRef.current?.getBoundingClientRect();
    if (!rect || durationMs === 0) return;
    seek(((e.clientX - rect.left) / rect.width) * durationMs);
  };

  const addCutPoint = () => {
    if (pendingCutStart === null) {
      setPendingCutStart(playheadMs);
    } else {
      const startMs = Math.min(pendingCutStart, playheadMs);
      const endMs = Math.max(pendingCutStart, playheadMs);
      if (endMs - startMs > 100) setCuts((prev) => [...prev, { startMs, endMs }].sort((a, b) => a.startMs - b.startMs));
      setPendingCutStart(null);
    }
  };

  const runExport = async (type: "mixed_video" | "mixed_audio") => {
    setExporting(true);
    try {
      await api(`/api/recordings/${recordingId}/exports`, {
        body: {
          type,
          trimStartMs: trimStartMs > 0 ? trimStartMs : undefined,
          trimEndMs: trimEndMs ?? undefined,
          cuts,
          aspect: type === "mixed_video" && aspect !== "16:9" ? aspect : undefined,
          captions: type === "mixed_video" && captions ? true : undefined,
        },
      });
      navigate(`/sessions/${data!.recording.session_id}`);
    } finally {
      setExporting(false);
    }
  };

  const cutSelectedWords = () => {
    const words = data?.transcriptWords;
    if (!words || wordAnchor === null || wordSelEnd === null) return;
    const [a, b] = [Math.min(wordAnchor, wordSelEnd), Math.max(wordAnchor, wordSelEnd)];
    const startMs = words[a].startMs;
    const endMs = Math.max(words[b].endMs, startMs + 120);
    setCuts((prev) => [...prev, { startMs, endMs }].sort((x, y) => x.startMs - y.startMs));
    setWordAnchor(null);
    setWordSelEnd(null);
  };

  const clickWord = (i: number) => {
    const words = data?.transcriptWords;
    if (!words) return;
    seek(words[i].startMs);
    if (wordAnchor === null) {
      setWordAnchor(i);
      setWordSelEnd(null);
    } else if (wordSelEnd === null && i !== wordAnchor) {
      setWordSelEnd(i);
    } else {
      setWordAnchor(i);
      setWordSelEnd(null);
    }
  };

  if (!data) return <div className="p-6 text-sm text-gray-400">Loading editor…</div>;
  if (readyTracks.length === 0) {
    return (
      <div className="p-6 text-sm text-gray-400">
        No ready tracks for this recording yet.{" "}
        <Link className="text-blue-300" to={`/sessions/${data.recording.session_id}`}>Back</Link>
      </div>
    );
  }

  const pct = (ms: number) => `${durationMs ? (ms / durationMs) * 100 : 0}%`;
  const cols = Math.ceil(Math.sqrt(videoTracks.length || 1));

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b border-edge bg-panel px-4 py-2.5">
        <div className="flex items-center gap-3">
          <Link to={`/sessions/${data.recording.session_id}`} className="text-sm text-gray-400 hover:text-white">
            ← {data.recording.session_title}
          </Link>
          <Badge tone="blue">editor</Badge>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-36">
            <Select
              value={aspect}
              onChange={setAspect}
              options={[
                { value: "16:9", label: "16:9 · landscape" },
                { value: "1:1", label: "1:1 · square" },
                { value: "9:16", label: "9:16 · vertical" },
              ]}
            />
          </div>
          {data?.transcriptSegments && (
            <label className="flex items-center gap-1.5 text-xs text-gray-300">
              <input
                type="checkbox"
                checked={captions}
                onChange={(e) => setCaptions(e.target.checked)}
                className="h-4 w-4 accent-[#4f7cff]"
              />
              Captions
            </label>
          )}
          <Button variant="ghost" disabled={exporting} onClick={() => void runExport("mixed_audio")}>
            Export audio
          </Button>
          <Button disabled={exporting} onClick={() => void runExport("mixed_video")}>
            {exporting ? "Queuing…" : "Export video"}
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Preview */}
        <main className="flex flex-1 flex-col p-4">
          <div
            className="grid flex-1 gap-2 overflow-hidden"
            style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
          >
            {videoTracks.map((track) => (
              <div key={track.id} className="relative overflow-hidden rounded-lg bg-panel-2">
                <video
                  ref={(el) => {
                    if (el) mediaRefs.current.set(track.id, el);
                    else mediaRefs.current.delete(track.id);
                  }}
                  src={`/api/tracks/${track.id}/download?kind=mp4&inline=1`}
                  preload="auto"
                  playsInline
                  className="h-full w-full object-contain"
                />
                <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 text-xs text-white">
                  {track.participant_name}
                  {track.type === "screen" ? " (screen)" : ""}
                </span>
              </div>
            ))}
          </div>
          {audioOnlyTracks.map((track) => (
            <audio
              key={track.id}
              ref={(el) => {
                if (el) mediaRefs.current.set(track.id, el);
                else mediaRefs.current.delete(track.id);
              }}
              src={`/api/tracks/${track.id}/download?kind=wav`}
              preload="auto"
            />
          ))}

          {/* Transport */}
          <div className="mt-3 flex items-center gap-3">
            <Button variant="ghost" onClick={() => setPlaying((p) => !p)}>
              {playing ? "Pause" : "Play"}
            </Button>
            <span className="w-28 text-sm tabular-nums text-gray-300">
              {formatDuration(playheadMs)} / {formatDuration(durationMs)}
            </span>
            <Button variant="ghost" onClick={() => setTrimStartMs(Math.min(playheadMs, effectiveTrimEnd - 100))}>
              Trim start here
            </Button>
            <Button variant="ghost" onClick={() => setTrimEndMs(Math.max(playheadMs, trimStartMs + 100))}>
              Trim end here
            </Button>
            <Button
              variant={pendingCutStart !== null ? "danger" : "ghost"}
              onClick={addCutPoint}
            >
              {pendingCutStart !== null ? "End cut here" : "Start cut here"}
            </Button>
          </div>

          {/* Timeline */}
          <div
            ref={timelineRef}
            onClick={timelineClick}
            className="relative mt-3 h-16 cursor-pointer select-none rounded-lg border border-edge bg-panel-2"
          >
            {/* trimmed-away regions */}
            <div className="absolute inset-y-0 left-0 bg-black/50" style={{ width: pct(trimStartMs) }} />
            <div
              className="absolute inset-y-0 right-0 bg-black/50"
              style={{ width: pct(Math.max(0, durationMs - effectiveTrimEnd)) }}
            />
            {/* cuts */}
            {cuts.map((cut, i) => (
              <div
                key={i}
                className="absolute inset-y-0 bg-rec/30"
                style={{ left: pct(cut.startMs), width: pct(cut.endMs - cut.startMs) }}
                title={`Cut ${formatDuration(cut.startMs)}–${formatDuration(cut.endMs)}`}
              />
            ))}
            {pendingCutStart !== null && (
              <div className="absolute inset-y-0 w-0.5 bg-rec" style={{ left: pct(pendingCutStart) }} />
            )}
            {/* track lanes */}
            {readyTracks.map((track, i) => (
              <div
                key={track.id}
                className="absolute h-1.5 rounded bg-accent/60"
                style={{
                  top: `${8 + i * 10}px`,
                  left: pct(Math.max(0, track.start_offset_ms)),
                  width: pct(track.duration_ms ?? 0),
                }}
                title={`${track.participant_name} · ${track.type}`}
              />
            ))}
            {/* playhead */}
            <div className="absolute inset-y-0 w-0.5 bg-white" style={{ left: pct(playheadMs) }} />
          </div>

          {/* Edit list */}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-400">
            <span>
              Trim: {formatDuration(trimStartMs)} → {formatDuration(effectiveTrimEnd)}
            </span>
            {cuts.map((cut, i) => (
              <span key={i} className="flex items-center gap-1 rounded bg-rec/15 px-2 py-0.5 text-rec">
                cut {formatDuration(cut.startMs)}–{formatDuration(cut.endMs)}
                <button
                  className="ml-1 hover:text-white"
                  onClick={() => setCuts((prev) => prev.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              </span>
            ))}
            <span className="ml-auto">
              Output length:{" "}
              {formatDuration(
                Math.max(
                  0,
                  effectiveTrimEnd -
                    trimStartMs -
                    cuts.reduce(
                      (s, c) =>
                        s +
                        Math.max(
                          0,
                          Math.min(c.endMs, effectiveTrimEnd) - Math.max(c.startMs, trimStartMs)
                        ),
                      0
                    )
                )
              )}
            </span>
          </div>
        </main>

        {/* Transcript rail: word-level text editing when word timings exist */}
        {((data.transcriptWords?.length ?? 0) > 0 || (data.transcriptSegments?.length ?? 0) > 0) && (
          <aside className="flex w-80 flex-col border-l border-edge bg-panel">
            <div className="border-b border-edge p-3">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                Transcript
              </h2>
              {data.transcriptWords?.length ? (
                wordAnchor !== null && wordSelEnd !== null ? (
                  <div className="mt-2 flex gap-2">
                    <Button variant="danger" onClick={cutSelectedWords} className="!py-1 text-xs">
                      Cut selected words
                    </Button>
                    <Button
                      variant="ghost"
                      className="!py-1 text-xs"
                      onClick={() => {
                        setWordAnchor(null);
                        setWordSelEnd(null);
                      }}
                    >
                      Clear
                    </Button>
                  </div>
                ) : (
                  <p className="mt-1 text-xs text-gray-500">
                    Click a word to seek and start a selection; click another to select the range,
                    then cut it — the video follows the text.
                  </p>
                )
              ) : (
                <p className="mt-1 text-xs text-gray-500">Click a line to seek.</p>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-3">
              {data.transcriptWords?.length
                ? (() => {
                    const words = data.transcriptWords!;
                    const selLo =
                      wordAnchor !== null
                        ? Math.min(wordAnchor, wordSelEnd ?? wordAnchor)
                        : null;
                    const selHi =
                      wordAnchor !== null
                        ? Math.max(wordAnchor, wordSelEnd ?? wordAnchor)
                        : null;
                    const blocks: { speaker: string; startIdx: number; words: TranscriptWord[] }[] = [];
                    words.forEach((w, i) => {
                      const last = blocks[blocks.length - 1];
                      if (!last || last.speaker !== w.speaker) {
                        blocks.push({ speaker: w.speaker, startIdx: i, words: [w] });
                      } else {
                        last.words.push(w);
                      }
                    });
                    return blocks.map((block, bi) => (
                      <div key={bi} className="mb-3">
                        <div className="mb-0.5 text-xs font-medium text-blue-300">
                          {block.speaker}
                          <span className="ml-2 tabular-nums text-gray-500">
                            {formatDuration(block.words[0].startMs)}
                          </span>
                        </div>
                        <div className="text-sm leading-6 text-gray-200">
                          {block.words.map((w, wi) => {
                            const idx = block.startIdx + wi;
                            const inCut = cuts.some(
                              (c) => w.startMs >= c.startMs && w.startMs < c.endMs
                            );
                            const selected = selLo !== null && idx >= selLo && idx <= selHi!;
                            const current = playheadMs >= w.startMs && playheadMs < w.endMs;
                            return (
                              <span
                                key={wi}
                                onClick={() => clickWord(idx)}
                                className={`cursor-pointer rounded px-0.5 hover:bg-panel-2 ${
                                  inCut ? "text-gray-500 line-through" : ""
                                } ${selected ? "bg-accent/40" : ""} ${current ? "bg-white/20" : ""}`}
                              >
                                {w.text}{" "}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    ));
                  })()
                : data.transcriptSegments!.map((seg, i) => {
                    const inCut = cuts.some((c) => seg.startMs >= c.startMs && seg.startMs < c.endMs);
                    return (
                      <button
                        key={i}
                        onClick={() => seek(seg.startMs)}
                        className={`mb-1 block w-full rounded px-2 py-1 text-left text-sm hover:bg-panel-2 ${
                          inCut ? "opacity-40 line-through" : ""
                        } ${playheadMs >= seg.startMs && playheadMs < seg.endMs ? "bg-accent/15" : ""}`}
                      >
                        <span className="mr-2 text-xs tabular-nums text-gray-500">
                          {formatDuration(seg.startMs)}
                        </span>
                        <span className="font-medium text-blue-300">{seg.speaker}:</span>{" "}
                        <span className="text-gray-200">{seg.text}</span>
                      </button>
                    );
                  })}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
