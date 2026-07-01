import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, type ParticipantInfo } from "../lib/api";
import { Lobby, type LobbyResult } from "../components/Lobby";
import { RoomView } from "../components/RoomView";

export function HostRoomPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [joinInfo, setJoinInfo] = useState<{
    participant: ParticipantInfo;
    token: string;
    session: { id: string; title: string };
  } | null>(null);
  const [lobbyResult, setLobbyResult] = useState<LobbyResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ participant: ParticipantInfo; token: string; session: { id: string; title: string } }>(
      `/api/sessions/${sessionId}/host-join`,
      { body: {} }
    )
      .then(setJoinInfo)
      .catch((err) => setError(err instanceof Error ? err.message : "Could not join"));
  }, [sessionId]);

  if (error) {
    return <div className="p-6 text-sm text-rec">{error}</div>;
  }
  if (!joinInfo) {
    return <div className="p-6 text-sm text-gray-400">Preparing studio…</div>;
  }

  if (!lobbyResult) {
    return (
      <Lobby
        title={joinInfo.session.title}
        subtitle="Set up your camera and microphone, then enter your studio."
        joinLabel="Enter studio"
        onJoin={setLobbyResult}
      />
    );
  }

  return (
    <RoomView
      config={{
        sessionId: joinInfo.session.id,
        participant: joinInfo.participant,
        token: joinInfo.token,
        isHost: true,
        preset: lobbyResult.settings.preset,
        recordWav: lobbyResult.settings.recordWav,
        cameraStream: lobbyResult.stream,
      }}
      sessionTitle={joinInfo.session.title}
      onLeave={() => navigate(`/sessions/${sessionId}`)}
    />
  );
}
