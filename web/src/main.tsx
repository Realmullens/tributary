import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { api, type User } from "./lib/api";
import { AuthPage } from "./pages/AuthPage";
import { DashboardPage } from "./pages/DashboardPage";
import { StudioPage } from "./pages/StudioPage";
import { SessionDetailPage } from "./pages/SessionDetailPage";
import { EditorPage } from "./pages/EditorPage";
import { HostRoomPage } from "./pages/HostRoomPage";
import { JoinPage } from "./pages/JoinPage";
import { RecoveryBanner } from "./components/RecoveryBanner";
import "./index.css";

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loaded, setLoaded] = useState(false);
  const location = useLocation();
  const isGuestRoute = location.pathname.startsWith("/join/");

  useEffect(() => {
    api<{ user: User | null }>("/api/auth/me")
      .then((res) => setUser(res.user))
      .catch(() => setUser(null))
      .finally(() => setLoaded(true));
  }, []);

  const logout = async () => {
    await api("/api/auth/logout", { body: {} });
    setUser(null);
  };

  if (!loaded && !isGuestRoute) {
    return <div className="p-6 text-sm text-gray-400">Loading…</div>;
  }

  return (
    <>
      <Routes>
        <Route path="/join/:inviteToken" element={<JoinPage />} />
        <Route path="/auth" element={<AuthPage onAuthed={setUser} />} />
        {user ? (
          <>
            <Route path="/" element={<DashboardPage user={user} onLogout={() => void logout()} />} />
            <Route path="/studios/:studioId" element={<StudioPage />} />
            <Route path="/sessions/:sessionId" element={<SessionDetailPage />} />
            <Route path="/sessions/:sessionId/room" element={<HostRoomPage />} />
            <Route path="/recordings/:recordingId/edit" element={<EditorPage />} />
          </>
        ) : (
          <Route path="*" element={<Navigate to="/auth" replace />} />
        )}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <RecoveryBanner />
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
);
