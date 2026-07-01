import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  api,
  type ExportItem,
  type Recording,
  type Session,
  type SessionParticipant,
  type Track,
} from "../lib/api";
import { Badge, Button, Card, formatBytes, formatDuration, statusTone } from "../components/ui";

const ACTIVE_STATES = ["recording", "uploading", "uploaded", "processing", "queued"];

export function SessionDetailPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [session, setSession] = useState<Session | null>(null);
  const [participants, setParticipants] = useState<SessionParticipant[]>([]);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [exports, setExports] = useState<ExportItem[]>([]);

  const load = useCallback(async () => {
    const res = await api<{
      session: Session;
      participants: SessionParticipant[];
      recordings: Recording[];
      tracks: Track[];
      exports: ExportItem[];
    }>(`/api/sessions/${sessionId}`);
    setSession(res.session);
    setParticipants(res.participants);
    setRecordings(res.recordings);
    setTracks(res.tracks);
    setExports(res.exports);
  }, [sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll while anything is in flight
  const anythingActive =
    tracks.some((t) => ACTIVE_STATES.includes(t.status)) ||
    exports.some((e) => ACTIVE_STATES.includes(e.status)) ||
    recordings.some((r) => ACTIVE_STATES.includes(r.status));
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
          <Button
            variant="ghost"
            onClick={() => void navigator.clipboard.writeText(`${location.origin}/join/${session.invite_token}`)}
          >
            Copy invite link
          </Button>
          <Link to={`/sessions/${session.id}/room`}>
            <Button>Enter studio</Button>
          </Link>
        </div>
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
                        {track.type}
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

            {/* Exports */}
            <div className="mt-4 flex items-center gap-2">
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
            </div>
            {recExports.length > 0 && (
              <div className="mt-3 flex flex-col gap-2">
                {recExports.map((exp) => (
                  <div key={exp.id} className="flex items-center justify-between rounded-lg bg-panel-2 px-3 py-2 text-sm">
                    <span className="text-gray-300">
                      {exp.type === "mixed_video" ? "Mixed video (MP4)" : "Mixed audio (WAV)"}
                      {exp.size_bytes ? ` · ${formatBytes(exp.size_bytes)}` : ""}
                    </span>
                    <span className="flex items-center gap-3">
                      <Badge tone={statusTone(exp.status)}>{exp.status}</Badge>
                      {exp.status === "ready" && (
                        <a className="text-xs text-blue-300 hover:underline" href={`/api/exports/${exp.id}/download`}>
                          Download
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
