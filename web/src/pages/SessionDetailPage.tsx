import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  api,
  type ExportItem,
  type Recording,
  type Session,
  type SessionParticipant,
  type Track,
  type TranscriptSegment,
  type TranscriptSummary,
} from "../lib/api";
import { Badge, Button, Card, formatBytes, formatDuration, statusTone } from "../components/ui";

const ACTIVE_STATES = ["recording", "uploading", "uploaded", "processing", "queued"];

function TranscriptViewer({ recordingId }: { recordingId: string }) {
  const [segments, setSegments] = useState<TranscriptSegment[] | null>(null);

  useEffect(() => {
    api<{ transcript: { segments: TranscriptSegment[] } }>(
      `/api/recordings/${recordingId}/transcript`
    )
      .then((res) => setSegments(res.transcript.segments))
      .catch(() => setSegments([]));
  }, [recordingId]);

  if (!segments) return <p className="text-xs text-gray-500">Loading transcript…</p>;
  return (
    <div className="max-h-72 overflow-y-auto rounded-lg bg-panel-2 p-3 text-sm">
      {segments.map((seg, i) => (
        <div key={i} className="mb-1.5 flex gap-3">
          <span className="w-14 shrink-0 text-xs tabular-nums text-gray-500">
            {formatDuration(seg.startMs)}
          </span>
          <span>
            <span className="font-medium text-blue-300">{seg.speaker}: </span>
            <span className="text-gray-200">{seg.text}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

export function SessionDetailPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [session, setSession] = useState<Session | null>(null);
  const [participants, setParticipants] = useState<SessionParticipant[]>([]);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [exports, setExports] = useState<ExportItem[]>([]);
  const [transcripts, setTranscripts] = useState<TranscriptSummary[]>([]);
  const [openTranscripts, setOpenTranscripts] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    const res = await api<{
      session: Session;
      participants: SessionParticipant[];
      recordings: Recording[];
      tracks: Track[];
      exports: ExportItem[];
      transcripts: TranscriptSummary[];
    }>(`/api/sessions/${sessionId}`);
    setSession(res.session);
    setParticipants(res.participants);
    setRecordings(res.recordings);
    setTracks(res.tracks);
    setExports(res.exports);
    setTranscripts(res.transcripts ?? []);
  }, [sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll while anything is in flight
  const anythingActive =
    tracks.some((t) => ACTIVE_STATES.includes(t.status)) ||
    exports.some((e) => ACTIVE_STATES.includes(e.status)) ||
    recordings.some((r) => ACTIVE_STATES.includes(r.status)) ||
    transcripts.some((t) => ACTIVE_STATES.includes(t.status));
  useEffect(() => {
    if (!anythingActive) return;
    const timer = setInterval(() => void load(), 4000);
    return () => clearInterval(timer);
  }, [anythingActive, load]);

  const createExport = async (recordingId: string, type: "mixed_video" | "mixed_audio") => {
    await api(`/api/recordings/${recordingId}/exports`, { body: { type } });
    await load();
  };

  const reprocess = async (trackId: string) => {
    await api(`/api/tracks/${trackId}/reprocess`, { body: {} });
    await load();
  };

  if (!session) return <div className="p-6 text-sm text-gray-400">Loading…</div>;

  return (
    <div className="mx-auto max-w-5xl p-6">
      <Link to={`/studios/${session.studio_id}`} className="text-sm text-gray-400 hover:text-white">
        ← Back to studio
      </Link>
      <div className="mt-2 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{session.title}</h1>
          <div className="mt-1 flex items-center gap-2 text-sm text-gray-400">
            <Badge tone={statusTone(session.status)}>{session.status}</Badge>
            <span>{new Date(session.created_at).toLocaleString()}</span>
          </div>
        </div>
        <div className="flex gap-2">
          {!session.ended_at && (
            <>
              <Button
                variant="ghost"
                onClick={() => void navigator.clipboard.writeText(`${location.origin}/join/${session.invite_token}`)}
              >
                Copy invite link
              </Button>
              <Button
                variant="ghost"
                onClick={async () => {
                  if (!confirm("End this session? Invite and watch links stop working (recordings are kept).")) return;
                  await api(`/api/sessions/${session.id}/end`, { body: {} });
                  await load();
                }}
              >
                End session
              </Button>
              <Link to={`/sessions/${session.id}/room`}>
                <Button>Enter studio</Button>
              </Link>
            </>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-6">
        <label className="flex items-center gap-2 text-sm text-gray-300">
          <input
            type="checkbox"
            checked={Boolean(session.auto_record)}
            onChange={async (e) => {
              await api(`/api/sessions/${session.id}`, { method: "PATCH", body: { autoRecord: e.target.checked } });
              await load();
            }}
            className="h-4 w-4 accent-[#4f7cff]"
          />
          Auto-record when the first guest joins (3s countdown)
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-300">
          <input
            type="checkbox"
            checked={Boolean(session.waiting_room)}
            onChange={async (e) => {
              await api(`/api/sessions/${session.id}`, { method: "PATCH", body: { waitingRoom: e.target.checked } });
              await load();
            }}
            className="h-4 w-4 accent-[#4f7cff]"
          />
          Guests wait in lobby until admitted
        </label>
      </div>

      {participants.length > 0 && (
        <Card className="mt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Participants</h2>
          <div className="mt-2 flex flex-wrap gap-2">
            {participants.map((p) => (
              <Badge key={p.id} tone={p.role === "host" ? "blue" : "gray"}>
                {p.name} · {p.role}
              </Badge>
            ))}
          </div>
        </Card>
      )}

      {recordings.length === 0 && (
        <Card className="mt-6">
          <p className="text-sm text-gray-400">
            No recordings yet. Enter the studio and hit Record — every participant's camera and mic
            will be captured locally at full quality and uploaded here.
          </p>
        </Card>
      )}

      {recordings.map((recording, index) => {
        const recTracks = tracks.filter((t) => t.recording_id === recording.id);
        const recExports = exports.filter((e) => e.recording_id === recording.id);
        const readyTracks = recTracks.filter((t) => t.status === "ready");
        const transcript = transcripts.find((t) => t.recording_id === recording.id);
        const transcriptOpen = openTranscripts.has(recording.id);
        return (
          <Card key={recording.id} className="mt-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold">
                  Take {recordings.length - index}
                  <span className="ml-2 text-sm font-normal text-gray-400">
                    {new Date(recording.started_at_ms).toLocaleString()}
                    {recording.stopped_at_ms &&
                      ` · ${formatDuration(recording.stopped_at_ms - recording.started_at_ms)}`}
                  </span>
                </h2>
              </div>
              <Badge tone={statusTone(recording.status)}>{recording.status}</Badge>
            </div>

            {/* Tracks */}
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-edge text-left text-xs uppercase tracking-wide text-gray-500">
                    <th className="py-2 pr-4">Participant</th>
                    <th className="py-2 pr-4">Track</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4">Size</th>
                    <th className="py-2 pr-4">Duration</th>
                    <th className="py-2">Downloads</th>
                  </tr>
                </thead>
                <tbody>
                  {recTracks.map((track) => (
                    <tr key={track.id} className="border-b border-edge/50">
                      <td className="py-2 pr-4">{track.participant_name}</td>
                      <td className="py-2 pr-4 text-gray-400">
                        {track.type === "pcm" ? "audio (48kHz WAV)" : track.type}
                        {track.width ? ` · ${track.width}×${track.height}` : ""}
                      </td>
                      <td className="py-2 pr-4">
                        <Badge tone={statusTone(track.status)}>{track.status}</Badge>
                        {track.status === "uploading" && track.final_chunk_count !== null && (
                          <span className="ml-2 text-xs text-gray-500">
                            {track.received_chunks}/{track.final_chunk_count} chunks
                          </span>
                        )}
                        {track.error && (
                          <span className="ml-2 text-xs text-rec" title={track.error}>error</span>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-gray-400">{formatBytes(track.size_bytes)}</td>
                      <td className="py-2 pr-4 text-gray-400">
                        {track.duration_ms ? formatDuration(track.duration_ms) : "—"}
                      </td>
                      <td className="py-2">
                        {track.status === "ready" ? (
                          <div className="flex gap-2 text-xs">
                            {track.width !== null && (
                              <a className="text-blue-300 hover:underline" href={`/api/tracks/${track.id}/download?kind=mp4`}>MP4</a>
                            )}
                            <a className="text-blue-300 hover:underline" href={`/api/tracks/${track.id}/download?kind=wav`}>WAV</a>
                            <a className="text-blue-300 hover:underline" href={`/api/tracks/${track.id}/download?kind=raw`}>Raw</a>
                            {track.enhanced ? (
                              <a className="text-emerald-300 hover:underline" href={`/api/tracks/${track.id}/download?kind=enhanced`}>
                                Enhanced
                              </a>
                            ) : (
                              track.type !== "screen" && (
                                <button
                                  className="text-blue-300 hover:underline"
                                  title="Noise reduction + loudness normalization; mixes prefer it automatically"
                                  onClick={async () => {
                                    await api(`/api/tracks/${track.id}/enhance`, { body: {} });
                                    await load();
                                  }}
                                >
                                  Enhance
                                </button>
                              )
                            )}
                          </div>
                        ) : track.status === "failed" ? (
                          <button onClick={() => void reprocess(track.id)} className="text-xs text-blue-300 hover:underline">
                            Retry processing
                          </button>
                        ) : (
                          <span className="text-xs text-gray-500">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {recTracks.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-3 text-gray-500">
                        No tracks were registered for this take.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Exports + transcription */}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button
                variant="ghost"
                disabled={readyTracks.length === 0}
                onClick={() => void createExport(recording.id, "mixed_video")}
              >
                Create mixed video
              </Button>
              <Button
                variant="ghost"
                disabled={readyTracks.length === 0}
                onClick={() => void createExport(recording.id, "mixed_audio")}
              >
                Create mixed audio
              </Button>
              <Button
                variant="ghost"
                disabled={readyTracks.length === 0 || ["queued", "processing"].includes(transcript?.status ?? "")}
                onClick={async () => {
                  await api(`/api/recordings/${recording.id}/transcribe`, { body: {} });
                  await load();
                }}
              >
                {transcript ? "Re-transcribe" : "Transcribe"}
              </Button>
              {transcript && (
                <span className="flex items-center gap-2">
                  <Badge tone={statusTone(transcript.status)}>transcript: {transcript.status}</Badge>
                  {transcript.status === "failed" && transcript.error && (
                    <span className="text-xs text-rec" title={transcript.error}>error</span>
                  )}
                </span>
              )}
              {readyTracks.length > 0 && (
                <>
                  <Link to={`/recordings/${recording.id}/edit`}>
                    <Button variant="ghost">Open editor</Button>
                  </Link>
                  <a
                    className="text-xs text-blue-300 hover:underline"
                    href={`/api/recordings/${recording.id}/xml`}
                    title="Premiere/Resolve-compatible timeline. Put it in the same folder as the downloaded MP4/WAV tracks."
                  >
                    Premiere/FCP XML
                  </a>
                </>
              )}
            </div>
            {transcript?.status === "ready" && (
              <div className="mt-3">
                <div className="flex items-center gap-3 text-xs">
                  <button
                    className="text-blue-300 hover:underline"
                    onClick={() =>
                      setOpenTranscripts((prev) => {
                        const next = new Set(prev);
                        if (next.has(recording.id)) next.delete(recording.id);
                        else next.add(recording.id);
                        return next;
                      })
                    }
                  >
                    {transcriptOpen ? "Hide transcript" : "Show transcript"}
                  </button>
                  <a className="text-blue-300 hover:underline" href={`/api/recordings/${recording.id}/transcript/download?format=txt`}>TXT</a>
                  <a className="text-blue-300 hover:underline" href={`/api/recordings/${recording.id}/transcript/download?format=srt`}>SRT</a>
                  <a className="text-blue-300 hover:underline" href={`/api/recordings/${recording.id}/transcript/download?format=vtt`}>VTT</a>
                  {transcript.language && <span className="text-gray-500">language: {transcript.language}</span>}
                </div>
                {transcriptOpen && (
                  <div className="mt-2">
                    <TranscriptViewer recordingId={recording.id} />
                  </div>
                )}
              </div>
            )}
            {recExports.length > 0 && (
              <div className="mt-3 flex flex-col gap-2">
                {recExports.map((exp) => (
                  <div key={exp.id} className="flex items-center justify-between rounded-lg bg-panel-2 px-3 py-2 text-sm">
                    <span className="text-gray-300">
                      {exp.type === "mixed_video" ? "Mixed video (MP4)" : "Mixed audio (WAV)"}
                      {exp.params_json ? " · edited" : ""}
                      {exp.duration_ms ? ` · ${formatDuration(exp.duration_ms)}` : ""}
                      {exp.size_bytes ? ` · ${formatBytes(exp.size_bytes)}` : ""}
                    </span>
                    <span className="flex items-center gap-3">
                      <Badge tone={statusTone(exp.status)}>{exp.status}</Badge>
                      {exp.status === "ready" && (
                        <a className="text-xs text-blue-300 hover:underline" href={`/api/exports/${exp.id}/download`}>
                          Download
                        </a>
                      )}
                      {exp.status === "ready" && exp.has_captions && (
                        <a className="text-xs text-blue-300 hover:underline" href={`/api/exports/${exp.id}/captions`}>
                          SRT
                        </a>
                      )}
                      {exp.error && (
                        <span className="text-xs text-rec" title={exp.error}>failed</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
