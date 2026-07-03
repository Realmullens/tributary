import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, type Session, type Studio, type StudioMember } from "../lib/api";
import { Badge, Button, Card, Input, Select, statusTone } from "../components/ui";

export function StudioPage() {
  const { studioId } = useParams<{ studioId: string }>();
  const [studio, setStudio] = useState<Studio | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [myRole, setMyRole] = useState<string>("editor");
  const [members, setMembers] = useState<StudioMember[]>([]);
  const [memberEmail, setMemberEmail] = useState("");
  const [memberRole, setMemberRole] = useState("editor");
  const [memberError, setMemberError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const res = await api<{ studio: Studio; sessions: Session[]; role: string }>(
      `/api/studios/${studioId}`
    );
    setStudio(res.studio);
    setSessions(res.sessions);
    setMyRole(res.role);
    const m = await api<{ members: StudioMember[] }>(`/api/studios/${studioId}/members`);
    setMembers(m.members);
  };

  const addMember = async () => {
    setMemberError(null);
    try {
      await api(`/api/studios/${studioId}/members`, {
        body: { email: memberEmail.trim(), role: memberRole },
      });
      setMemberEmail("");
      await load();
    } catch (err) {
      setMemberError(err instanceof Error ? err.message : "Could not add member");
    }
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

  if (!studio) return <div className="min-h-screen bg-ink p-6 text-sm text-gray-400">Loading…</div>;

  return (
    <div className="min-h-screen bg-ink">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-edge bg-panel px-6 py-3">
        <h1 className="text-2xl">
          <span className="bg-gradient-to-r from-accent-2 to-accent bg-clip-text font-bold tracking-tight text-transparent">
            Tributary
          </span>
        </h1>
        <Link to="/" className="text-sm text-gray-400 hover:text-white">
          ← Studios
        </Link>
      </header>

      <main className="mx-auto max-w-5xl p-6">
        <h2 className="text-2xl font-bold tracking-tight">{studio.name}</h2>

        <Card className="mt-6 !rounded-2xl !border-0 !bg-panel ring-1 ring-edge">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
            New recording session
          </h3>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row">
            <Input
              placeholder="Session title (e.g. Episode 12 - Guest interview)"
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
            <Card
              key={session.id}
              className="flex flex-col gap-4 !rounded-2xl !border-0 !bg-panel ring-1 ring-edge transition-colors hover:ring-accent/50 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <Link to={`/sessions/${session.id}`} className="font-semibold hover:text-accent-2">
                  {session.title}
                </Link>
                <div className="mt-1 flex items-center gap-2 text-sm text-gray-400">
                  <Badge tone={statusTone(session.status)}>{session.status}</Badge>
                  <span>{new Date(session.created_at).toLocaleString()}</span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
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
            <p className="text-sm text-gray-500">
              No sessions yet - create one, then enter the studio and invite guests.
            </p>
          )}
        </div>

        {/* Team */}
        <Card className="mt-8 !rounded-2xl !border-0 !bg-panel ring-1 ring-edge">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">Team</h3>
          <div className="mt-3 flex flex-col gap-2">
            {members.map((m) => (
              <div key={m.id} className="flex flex-col gap-2 rounded-2xl bg-panel-2 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                <span>
                  {m.name} <span className="text-gray-500">· {m.email}</span>
                </span>
                <span className="flex items-center gap-3">
                  <Badge tone={m.role === "owner" ? "blue" : "gray"}>{m.role}</Badge>
                  {myRole === "owner" && (
                    <button
                      className="text-xs text-gray-400 hover:text-rec"
                      onClick={async () => {
                        await api(`/api/studios/${studioId}/members/${m.id}`, { method: "DELETE" }).catch(() => {});
                        await load();
                      }}
                    >
                      Remove
                    </button>
                  )}
                </span>
              </div>
            ))}
          </div>
          {myRole === "owner" && (
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <Input
                placeholder="teammate@example.com"
                value={memberEmail}
                onChange={(e) => setMemberEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void addMember()}
              />
              <div className="sm:w-32">
                <Select
                  value={memberRole}
                  onChange={setMemberRole}
                  options={[
                    { value: "editor", label: "Editor" },
                    { value: "owner", label: "Owner" },
                  ]}
                />
              </div>
              <Button onClick={() => void addMember()} disabled={!memberEmail.trim()}>
                Add
              </Button>
            </div>
          )}
          {memberError && <p className="mt-2 text-sm text-rec">{memberError}</p>}
          <p className="mt-2 text-xs text-gray-500">
            Editors can create sessions, record, edit, and export. Owners can also manage the team
            and delete the studio.
          </p>
        </Card>
      </main>
    </div>
  );
}
