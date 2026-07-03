import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type User } from "../lib/api";
import { Button, Card, Input } from "../components/ui";

export function AuthPage({ onAuthed }: { onAuthed: (user: User) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      const path = mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const body = mode === "login" ? { email, password } : { email, name, password };
      const res = await api<{ user: User }>(path, { body });
      onAuthed(res.user);
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink p-6">
      <Card className="w-full max-w-sm !rounded-2xl !border-0 !bg-panel !p-8 ring-1 ring-edge">
        <h1 className="text-center text-3xl">
          <span className="bg-gradient-to-r from-accent-2 to-accent bg-clip-text font-bold tracking-tight text-transparent">
            Tributary
          </span>
        </h1>
        <div className="mt-6 text-center">
          <h2 className="text-2xl font-bold tracking-tight">
            {mode === "login" ? "Sign in to your studio" : "Create your host account"}
          </h2>
          <p className="mt-2 text-sm text-gray-400">
            {mode === "login"
              ? "Welcome back. Pick up where your recordings left off."
              : "Set up your host account and start recording."}
          </p>
        </div>
        <div className="mt-5 flex flex-col gap-3">
          {mode === "register" && (
            <Input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
          )}
          <Input
            placeholder="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Input
            placeholder="Password (8+ characters)"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
          />
          {error && <p className="text-sm text-rec">{error}</p>}
          <Button className="w-full" onClick={() => void submit()} disabled={busy}>
            {mode === "login" ? "Sign in" : "Create account"}
          </Button>
          <button
            onClick={() => setMode(mode === "login" ? "register" : "login")}
            className="text-sm text-gray-400 hover:text-white"
          >
            {mode === "login" ? "New here? Create an account" : "Have an account? Sign in"}
          </button>
        </div>
      </Card>
    </div>
  );
}
