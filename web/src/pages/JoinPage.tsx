import { type ReactNode, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, type ParticipantInfo } from "../lib/api";
import { Lobby, type LobbyResult } from "../components/Lobby";
import { RoomView } from "../components/RoomView";
import { Button, Card, Input } from "../components/ui";

type InviteInfo = { session: { id: string; title: string; status: string }; studioName: string };
type Joined = { participant: ParticipantInfo; token: string; session: { id: string; title: string } };

function GuestShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-ink">
      <header className="border-b border-edge bg-panel px-6 py-3">
        <span className="bg-gradient-to-r from-accent-2 to-accent bg-clip-text text-2xl font-bold tracking-tight text-transparent">
          Tributary
        </span>
      </header>
      <main className="flex min-h-[calc(100vh-57px)] items-center justify-center p-6">{children}</main>
    </div>
  );
}

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
      <GuestShell>
        <Card className="w-full max-w-sm text-center !rounded-2xl !border-0 !bg-panel !p-8 ring-1 ring-edge">
          <h1 className="text-2xl font-bold tracking-tight">Can't join</h1>
          <p className="mt-2 text-sm text-gray-400">{error}</p>
        </Card>
      </GuestShell>
    );
  }
  if (!invite) {
    return (
      <GuestShell>
        <div className="text-sm text-gray-400">Loading…</div>
      </GuestShell>
    );
  }

  if (left) {
    return (
      <GuestShell>
        <Card className="w-full max-w-sm text-center !rounded-2xl !border-0 !bg-panel !p-8 ring-1 ring-edge">
          <h1 className="text-2xl font-bold tracking-tight">Thanks for joining!</h1>
          <p className="mt-2 text-sm text-gray-400">
            You've left {invite.session.title}. If a recording was uploading, keep this browser
            around — reopening this link resumes any unfinished upload automatically.
          </p>
        </Card>
      </GuestShell>
    );
  }

  if (!joined) {
    return (
      <GuestShell>
        <Card className="w-full max-w-sm !rounded-2xl !border-0 !bg-panel !p-8 ring-1 ring-edge">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">{invite.studioName}</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">{invite.session.title}</h1>
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
            <Button className="w-full" onClick={() => void join()} disabled={!name.trim()}>
              Continue
            </Button>
          </div>
        </Card>
      </GuestShell>
    );
  }

  if (!lobbyResult) {
    return (
      <GuestShell>
        <Lobby
          title={joined.session.title}
          subtitle={`Joining as ${joined.participant.name}. Check your devices, then join.`}
          joinLabel="Join studio"
          onJoin={setLobbyResult}
        />
      </GuestShell>
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
        recordWav: lobbyResult.settings.recordWav,
        cameraStream: lobbyResult.stream,
      }}
      sessionTitle={joined.session.title}
      onLeave={() => setLeft(true)}
    />
  );
}
