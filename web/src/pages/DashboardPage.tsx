import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Studio, type User } from "../lib/api";
import { Button, Card, Input } from "../components/ui";

export function DashboardPage({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [studios, setStudios] = useState<Studio[]>([]);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const load = async () => {
    const res = await api<{ studios: Studio[] }>("/api/studios");
    setStudios(res.studios);
  };

  useEffect(() => {
    void load();
  }, []);

  const createStudio = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await api("/api/studios", { body: { name: newName.trim() } });
      setNewName("");
      await load();
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="min-h-screen bg-ink">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-edge bg-panel px-6 py-3">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-2xl">
            <span className="bg-gradient-to-r from-accent-2 to-accent bg-clip-text font-bold tracking-tight text-transparent">
              Tributary
            </span>
          </h1>
          <p className="truncate text-sm text-gray-400">Signed in as {user.name}</p>
        </div>
        <Button variant="ghost" onClick={onLogout}>
          Sign out
        </Button>
      </header>

      <main className="mx-auto max-w-5xl p-6">
        <Card className="!rounded-2xl !border-0 !bg-panel ring-1 ring-edge">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500">New studio</h2>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row">
            <Input
              placeholder="Studio name (e.g. The Weekly Show)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void createStudio()}
            />
            <Button className="sm:w-auto" onClick={() => void createStudio()} disabled={creating || !newName.trim()}>
              Create
            </Button>
          </div>
        </Card>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {studios.map((studio) => (
            <Link key={studio.id} to={`/studios/${studio.id}`} className="block">
              <Card className="!rounded-2xl !border-0 !bg-panel ring-1 ring-edge transition-colors hover:ring-accent/50">
                <h3 className="font-semibold">{studio.name}</h3>
                <p className="mt-1 text-sm text-gray-400">
                  {studio.session_count ?? 0} session{(studio.session_count ?? 0) === 1 ? "" : "s"}
                </p>
              </Card>
            </Link>
          ))}
          {studios.length === 0 && (
            <p className="text-sm text-gray-500">No studios yet - create one to start recording.</p>
          )}
        </div>
      </main>
    </div>
  );
}
