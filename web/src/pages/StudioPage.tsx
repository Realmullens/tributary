import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type Session, type Studio } from "../lib/api";
import { Badge, Button, Card, Input, statusTone } from "../components/ui";

export function StudioPage() {
  const { studioId } = useParams<{ studioId: string }>();
  const [studio, setStudio] = useState<Studio | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const res = await api<{ studio: Studio; sessions: Session[] }>(`/api/studios/${studioId}`);
    setStudio(res.studio);
    setSessions(res.sessions);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studioId]);

  const createSession = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      await api(`/api/studios/${studioId}/sessions`, { body: { title: title.trim() } });
      setTitle("");
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (!studio) return <div className="p-6 text-sm text-gray-400">Loading…</div>;

  return (
    <div className="mx-auto max-w-4xl p-6">
      <Link to="/" className="text-sm text-gray-400 hover:text-white">← Studios</Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">{studio.name}</h1>

      <Card className="mt-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">New recording session</h2>
        <div className="mt-3 flex gap-3">
          <Input
            placeholder="Session title (e.g. Episode 12 — Guest interview)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void createSession()}
          />
          <Button onClick={() => void createSession()} disabled={busy || !title.trim()}>
            Create
          </Button>
        </div>
      </Card>

      <div className="mt-6 flex flex-col gap-3">
        {sessions.map((session) => (
          <Card key={session.id} className="flex items-center justify-between">
            <div>
              <Link to={`/sessions/${session.id}`} className="font-semibold hover:text-blue-300">
                {session.title}
              </Link>
              <div className="mt-1 flex items-center gap-2 text-sm text-gray-400">
                <Badge tone={statusTone(session.status)}>{session.status}</Badge>
                <span>{new Date(session.created_at).toLocaleString()}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  void navigator.clipboard.writeText(`${location.origin}/join/${session.invite_token}`);
                }}
                title="Copy the guest invite link"
              >
                Copy invite link
              </Button>
              <Link to={`/sessions/${session.id}/room`}>
                <Button>Enter studio</Button>
              </Link>
            </div>
          </Card>
        ))}
        {sessions.length === 0 && (
          <p className="text-sm text-gray-500">No sessions yet — create one, then enter the studio and invite guests.</p>
        )}
      </div>
    </div>
  );
}
