import { useEffect, useState } from "react";
import { useRoom, type RoomConfig } from "../lib/useRoom";
import { Badge, Button, formatBytes, formatDuration } from "./ui";
import { ChatPanel } from "./ChatPanel";
import { Teleprompter } from "./Teleprompter";
import { VideoTile } from "./VideoTile";

function ControlButton({
  label,
  active,
  onClick,
  danger,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-xl px-4 py-2.5 text-sm font-medium transition-colors ${
        danger
          ? "bg-rec/90 text-white hover:bg-rec"
          : active === false
            ? "bg-rec/20 text-rec border border-rec/40"
            : "bg-panel-2 text-gray-100 border border-edge hover:bg-edge"
      }`}
    >
      {label}
    </button>
  );
}

export function RoomView({
  config,
  sessionTitle,
  onLeave,
}: {
  config: RoomConfig;
  sessionTitle: string;
  onLeave: () => void;
}) {
  const room = useRoom(config);
  const [chatOpen, setChatOpen] = useState(false);
  const [prompterOpen, setPrompterOpen] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [countdownLeft, setCountdownLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!room.recording) return;
    const started = room.recording.startedAtMs;
    const timer = setInterval(() => setElapsedMs(Date.now() - started), 500);
    return () => clearInterval(timer);
  }, [room.recording]);

  useEffect(() => {
    if (!room.countdownEndsAt) {
      setCountdownLeft(null);
      return;
    }
    const tick = () => {
      const left = Math.ceil((room.countdownEndsAt! - Date.now()) / 1000);
      setCountdownLeft(left > 0 ? left : null);
    };
    tick();
    const timer = setInterval(tick, 200);
    return () => clearInterval(timer);
  }, [room.countdownEndsAt]);

  const uploadsPending =
    room.myUpload !== null && room.myUpload.state !== "complete" && !room.recording;
  const peerScreens = room.peers.filter((p) => p.media.screen);

  const leave = () => {
    if (room.recording) {
      if (!confirm("Recording is in progress. Leave anyway?")) return;
    } else if (uploadsPending) {
      if (!confirm("Your recording is still uploading. Leaving now may lose media. Leave anyway?")) return;
    }
    config.cameraStream.getTracks().forEach((t) => t.stop());
    onLeave();
  };

  if (room.replaced) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 p-8 text-center">
        <h1 className="text-xl font-semibold">Opened somewhere else</h1>
        <p className="max-w-md text-sm text-gray-400">
          This session was opened in another tab or window, which is now the active connection.
        </p>
      </div>
    );
  }

  if (room.declined) {
    config.cameraStream.getTracks().forEach((t) => t.stop());
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 p-8 text-center">
        <h1 className="text-xl font-semibold">Entry declined</h1>
        <p className="max-w-md text-sm text-gray-400">The host declined your request to join.</p>
      </div>
    );
  }

  if (room.waiting) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 p-8 text-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-600 border-t-white" />
        <h1 className="text-xl font-semibold">Waiting for the host to let you in</h1>
        <p className="max-w-md text-sm text-gray-400">
          You're in the waiting room for {sessionTitle}. Keep this tab open — you'll join
          automatically once admitted.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-edge bg-panel px-4 py-2.5">
        <div className="flex items-center gap-3">
          <span className="font-semibold tracking-tight">Tributary</span>
          <span className="text-sm text-gray-400">{sessionTitle}</span>
          {!room.connected && <Badge tone="yellow">reconnecting…</Badge>}
        </div>
        <div className="flex items-center gap-3">
          {room.recording ? (
            <span className="flex items-center gap-2 rounded-lg bg-rec/15 px-3 py-1 text-sm font-medium text-rec">
              <span className="h-2 w-2 animate-pulse rounded-full bg-rec" />
              REC {formatDuration(elapsedMs)}
            </span>
          ) : (
            <span className="text-sm text-gray-500">Not recording</span>
          )}
          {room.myUpload && room.myUpload.state !== "complete" && (
            <Badge tone={room.myUpload.state === "delayed" ? "red" : "blue"}>
              upload {room.myUpload.percent}%
            </Badge>
          )}
        </div>
      </header>

      {room.error && (
        <div className="flex items-center justify-between border-b border-rec/40 bg-rec/10 px-4 py-2 text-sm text-rec">
          {room.error}
          <button onClick={room.dismissError} className="ml-4 text-rec hover:text-white">✕</button>
        </div>
      )}

      {/* Waiting-room queue (hosts only) */}
      {config.isHost &&
        room.waitingGuests.map((guest) => (
          <div
            key={guest.participantId}
            className="flex items-center justify-between border-b border-accent/40 bg-accent/10 px-4 py-2 text-sm"
          >
            <span>
              <span className="font-medium">{guest.name}</span> is waiting to join
            </span>
            <span className="flex gap-2">
              <Button onClick={() => room.admitGuest(guest.participantId)}>Admit</Button>
              <Button variant="ghost" onClick={() => room.declineGuest(guest.participantId)}>
                Decline
              </Button>
            </span>
          </div>
        ))}

      {/* Stage */}
      <div className="flex min-h-0 flex-1">
        <main className="flex-1 overflow-y-auto p-4">
          <div
            className="grid gap-4"
            style={{
              gridTemplateColumns: `repeat(${Math.min(3, Math.max(1, Math.ceil(Math.sqrt(room.peers.length + 1))))}, minmax(0, 1fr))`,
            }}
          >
            {(room.screenStream || peerScreens.length > 0) && (
              <div className="col-span-full grid gap-4">
                {room.screenStream && (
                  <VideoTile stream={room.screenStream} name="Your screen" isSelf muted large />
                )}
                {peerScreens.map((p) => (
                  <VideoTile key={`${p.participantId}-screen`} stream={p.media.screen} name={`${p.name}'s screen`} muted large />
                ))}
              </div>
            )}
            <VideoTile
              stream={config.cameraStream}
              name={config.participant.name}
              isSelf
              micOn={room.micOn}
              camOn={room.camOn}
              upload={room.myUpload}
            />
            {room.peers.map((p) => (
              <VideoTile
                key={p.participantId}
                stream={p.media.camera}
                name={p.name}
                micOn={p.state.mic}
                camOn={p.state.cam}
                upload={p.upload}
                onHostMute={config.isHost ? () => room.muteGuest(p.participantId) : undefined}
              />
            ))}
          </div>
          {room.peers.length === 0 && (
            <p className="mt-6 text-center text-sm text-gray-500">
              You're the only one here. Share the invite link to bring in guests.
            </p>
          )}
        </main>
        {chatOpen && (
          <ChatPanel
            messages={room.chat}
            selfId={config.participant.id}
            onSend={room.sendChat}
            onClose={() => setChatOpen(false)}
          />
        )}
        {prompterOpen && (
          <Teleprompter
            script={room.teleprompter}
            canEdit={config.isHost}
            onSave={room.saveTeleprompter}
            onClose={() => setPrompterOpen(false)}
          />
        )}
      </div>

      {/* Controls */}
      <footer className="flex items-center justify-center gap-3 border-t border-edge bg-panel px-4 py-3">
        <ControlButton label={room.micOn ? "Mute" : "Unmute"} active={room.micOn} onClick={room.toggleMic} />
        <ControlButton label={room.camOn ? "Camera off" : "Camera on"} active={room.camOn} onClick={room.toggleCam} />
        <ControlButton
          label={room.screenStream ? "Stop sharing" : "Share screen"}
          onClick={room.screenStream ? room.stopShare : () => void room.startShare()}
        />
        <ControlButton label={chatOpen ? "Hide chat" : "Chat"} onClick={() => setChatOpen((v) => !v)} />
        <ControlButton
          label={prompterOpen ? "Hide script" : "Script"}
          onClick={() => setPrompterOpen((v) => !v)}
        />
        {(room.recording || (room.myUpload && room.myUpload.state !== "complete")) && (
          <ControlButton
            label={room.uploadsPaused ? "Resume uploads" : "Pause uploads"}
            active={!room.uploadsPaused}
            onClick={room.toggleUploadsPaused}
          />
        )}
        {config.isHost &&
          (room.recording || countdownLeft !== null ? (
            <Button variant="rec" onClick={() => void room.stopRecording()}>
              ■ {countdownLeft !== null ? "Cancel" : "Stop recording"}
            </Button>
          ) : (
            <Button variant="rec" onClick={() => void room.startRecording()}>
              ● Record
            </Button>
          ))}
        <ControlButton label="Leave" danger onClick={leave} />
      </footer>

      {/* Recording countdown overlay */}
      {countdownLeft !== null && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="text-center">
            <div className="text-[10rem] font-bold leading-none text-white drop-shadow-lg">{countdownLeft}</div>
            <p className="mt-2 text-lg text-gray-200">Recording starts…</p>
          </div>
        </div>
      )}

      {/* Post-stop upload overlay */}
      {uploadsPending && room.myUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
          <div className="w-full max-w-md rounded-xl border border-edge bg-panel p-6">
            <h2 className="text-lg font-semibold">Recording stopped — uploading</h2>
            <p className="mt-2 text-sm text-gray-400">
              Keep this tab open until the upload finishes. Your recording is stored locally and
              uploads even on a weak connection.
            </p>
            <div className="mt-4 h-2 overflow-hidden rounded bg-panel-2">
              <div
                className="h-full rounded bg-accent transition-[width]"
                style={{ width: `${room.myUpload.percent}%` }}
              />
            </div>
            <div className="mt-2 flex justify-between text-xs text-gray-400">
              <span>
                {formatBytes(room.myUpload.uploadedBytes)} / {formatBytes(room.myUpload.totalBytes)}
              </span>
              <span>
                {room.myUpload.state === "delayed" ? "Connection issues — retrying…" : `${room.myUpload.percent}%`}
              </span>
            </div>
          </div>
        </div>
      )}
      {room.myUpload?.state === "complete" && !room.recording && (
        <div className="pointer-events-none fixed bottom-20 left-1/2 z-40 -translate-x-1/2 rounded-lg bg-emerald-500/15 px-4 py-2 text-sm text-emerald-300">
          All uploads complete ✓
        </div>
      )}
    </div>
  );
}
