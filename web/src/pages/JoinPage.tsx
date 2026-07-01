import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, type ParticipantInfo } from "../lib/api";
import { Lobby, type LobbyResult } from "../components/Lobby";
import { RoomView } from "../components/RoomView";
import { Button, Card, Input } from "../components/ui";

type InviteInfo = { session: { id: string; title: string; status: string }; studioName: string };
type Joined = { participant: ParticipantInfo; token: string; session: { id: string; title: string } };

export function JoinPage() {
  const { inviteToken } = useParams<{ inviteToken: string }>();
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [joined, setJoined] = useState<Joined | null>(null);
  const [lobbyResult, setLobbyResult] = useState<LobbyResult | null>(null);
  const [left, setLeft] = useState(false);

  const storageKey = `tributary-guest-${inviteToken}`;

  useEffect(() => {
    api<InviteInfo>(`/api/join/${inviteToken}`)
      .then(async (info) => {
        setInvite(info);
        // If this browser already joined this session, reuse the participant.
        const savedToken = localStorage.getItem(storageKey);
        if (savedToken) {
          try {
            const me = await api<{ participant: ParticipantInfo; session: { id: string; title: string } }>(
              "/api/participants/me",
              { token: savedToken }
            );
            setJoined({ participant: me.participant, token: savedToken, session: me.session });
          } catch {
            localStorage.removeItem(storageKey);
          }
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Invalid invite link"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inviteToken]);

  const join = async () => {
    if (!name.trim()) return;
    try {
      const res = await api<Joined>(`/api/join/${inviteToken}`, { body: { name: name.trim() } });
      localStorage.setItem(storageKey, res.token);
      setJoined(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not join");
    }
  };

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <Card className="max-w-sm text-center">
          <h1 className="text-lg font-semibold">Can't join</h1>
          <p className="mt-2 text-sm text-gray-400">{error}</p>
        </Card>
      </div>
    );
  }
  if (!invite) return <div className="p-6 text-sm text-gray-400">Loading…</div>;

  if (left) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <Card className="max-w-sm text-center">
          <h1 className="text-lg font-semibold">Thanks for joining!</h1>
          <p className="mt-2 text-sm text-gray-400">
            You've left {invite.session.title}. If a recording was uploading, keep this browser
            around — reopening this link resumes any unfinished upload automatically.
          </p>
        </Card>
      </div>
    );
  }

  if (!joined) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <Card className="w-full max-w-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-400">{invite.studioName}</p>
          <h1 className="mt-1 text-xl font-semibold">{invite.session.title}</h1>
          <p className="mt-2 text-sm text-gray-400">
            You've been invited to a recording session. Your camera and mic will be recorded locally
            in full quality while you talk.
          </p>
          <div className="mt-4 flex flex-col gap-3">
            <Input
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void join()}
            />
            <Button onClick={() => void join()} disabled={!name.trim()}>Continue</Button>
          </div>
        </Card>
      </div>
    );
  }

  if (!lobbyResult) {
    return (
      <Lobby
        title={joined.session.title}
        subtitle={`Joining as ${joined.participant.name}. Check your devices, then join.`}
        joinLabel="Join studio"
        onJoin={setLobbyResult}
      />
    );
  }

  return (
    <RoomView
      config={{
        sessionId: joined.session.id,
        participant: joined.participant,
        token: joined.token,
        isHost: false,
        preset: lobbyResult.settings.preset,
        cameraStream: lobbyResult.stream,
      }}
      sessionTitle={joined.session.title}
      onLeave={() => setLeft(true)}
    />
  );
}
