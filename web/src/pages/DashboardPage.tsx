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
    <div className="mx-auto max-w-4xl p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Tributary</h1>
          <p className="text-sm text-gray-400">Signed in as {user.name}</p>
        </div>
        <Button variant="ghost" onClick={onLogout}>Sign out</Button>
      </header>

      <Card className="mt-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">New studio</h2>
        <div className="mt-3 flex gap-3">
          <Input
            placeholder="Studio name (e.g. The Weekly Show)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void createStudio()}
          />
          <Button onClick={() => void createStudio()} disabled={creating || !newName.trim()}>
            Create
          </Button>
        </div>
      </Card>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {studios.map((studio) => (
          <Link key={studio.id} to={`/studios/${studio.id}`}>
            <Card className="transition-colors hover:border-accent">
              <h3 className="font-semibold">{studio.name}</h3>
              <p className="mt-1 text-sm text-gray-400">
                {studio.session_count ?? 0} session{(studio.session_count ?? 0) === 1 ? "" : "s"}
              </p>
            </Card>
          </Link>
        ))}
        {studios.length === 0 && (
          <p className="text-sm text-gray-500">No studios yet — create one to start recording.</p>
        )}
      </div>
    </div>
  );
}
