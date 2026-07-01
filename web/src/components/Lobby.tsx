import { useEffect, useRef, useState } from "react";
import { buildConstraints, listDevices, watchMicLevel, type CaptureSettings, type DeviceInfo } from "../lib/media";
import type { QualityPreset } from "../lib/recorder/recorder";
import { Button, Card, Select } from "./ui";

export type LobbyResult = { stream: MediaStream; settings: CaptureSettings };

/**
 * Pre-join device check: camera preview, mic meter, device pickers,
 * headphones (echo cancellation) question, quality preset.
 */
export function Lobby({
  title,
  subtitle,
  joinLabel,
  showQualityPicker,
  onJoin,
}: {
  title: string;
  subtitle?: string;
  joinLabel: string;
  showQualityPicker?: boolean;
  onJoin: (result: LobbyResult) => void;
}) {
  const [cameras, setCameras] = useState<DeviceInfo[]>([]);
  const [microphones, setMicrophones] = useState<DeviceInfo[]>([]);
  const [cameraId, setCameraId] = useState<string>("");
  const [microphoneId, setMicrophoneId] = useState<string>("");
  const [preset, setPreset] = useState<QualityPreset>("standard");
  const [headphones, setHeadphones] = useState(false);
  const [recordWav, setRecordWav] = useState(true);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [micLevel, setMicLevel] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const settings: CaptureSettings = {
    cameraId: cameraId || null,
    microphoneId: microphoneId || null,
    preset,
    echoCancellation: !headphones,
    recordWav,
  };

  useEffect(() => {
    let cancelled = false;
    let cleanupMeter: (() => void) | null = null;

    async function acquire() {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      setPermissionError(null);
      try {
        const media = await navigator.mediaDevices.getUserMedia(buildConstraints(settings));
        if (cancelled) {
          media.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = media;
        setStream(media);
        cleanupMeter = watchMicLevel(media, setMicLevel);
        const devices = await listDevices();
        if (!cancelled) {
          setCameras(devices.cameras);
          setMicrophones(devices.microphones);
        }
      } catch (err) {
        if (!cancelled) {
          setStream(null);
          setPermissionError(
            err instanceof DOMException && err.name === "NotAllowedError"
              ? "Camera/microphone permission was denied. Allow access in your browser's site settings, then reload."
              : `Could not access devices: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
    }
    void acquire();

    return () => {
      cancelled = true;
      cleanupMeter?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraId, microphoneId, preset, headphones]);

  // Stop preview tracks when the lobby unmounts WITHOUT joining
  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    },
    []
  );

  useEffect(() => {
    if (videoRef.current && videoRef.current.srcObject !== stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  const join = () => {
    if (!stream) return;
    streamRef.current = null; // ownership transfers to the room
    onJoin({ stream, settings });
  };

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6 md:flex-row">
      <div className="flex-1">
        <div className="relative overflow-hidden rounded-xl border border-edge bg-panel-2" style={{ aspectRatio: "16/9" }}>
          {stream && preset !== "audio" ? (
            <video ref={videoRef} autoPlay playsInline muted className="h-full w-full scale-x-[-1] object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-gray-500">
              {permissionError ? "No camera" : preset === "audio" ? "Audio-only mode" : "Starting camera…"}
            </div>
          )}
          <div className="absolute bottom-2 left-2 right-2 h-1.5 overflow-hidden rounded bg-black/40">
            <div
              className="h-full rounded bg-emerald-400 transition-[width] duration-75"
              style={{ width: `${Math.round(micLevel * 100)}%` }}
            />
          </div>
        </div>
        {permissionError && (
          <p className="mt-3 rounded-lg border border-rec/40 bg-rec/10 p-3 text-sm text-rec">{permissionError}</p>
        )}
      </div>

      <Card className="w-full md:w-80">
        <h1 className="text-lg font-semibold">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-gray-400">{subtitle}</p>}
        <div className="mt-4 flex flex-col gap-3">
          <label className="text-xs font-medium uppercase tracking-wide text-gray-400">Camera</label>
          <Select
            value={cameraId}
            onChange={setCameraId}
            disabled={preset === "audio"}
            options={[{ value: "", label: "Default camera" }, ...cameras.map((c) => ({ value: c.deviceId, label: c.label }))]}
          />
          <label className="text-xs font-medium uppercase tracking-wide text-gray-400">Microphone</label>
          <Select
            value={microphoneId}
            onChange={setMicrophoneId}
            options={[{ value: "", label: "Default microphone" }, ...microphones.map((m) => ({ value: m.deviceId, label: m.label }))]}
          />
          {showQualityPicker !== false && (
            <>
              <label className="text-xs font-medium uppercase tracking-wide text-gray-400">Recording quality</label>
              <Select
                value={preset}
                onChange={(v) => setPreset(v as QualityPreset)}
                options={[
                  { value: "standard", label: "Standard — 720p" },
                  { value: "high", label: "High — 1080p" },
                  { value: "ultra", label: "Ultra — 4K (device permitting)" },
                  { value: "audio", label: "Audio only" },
                ]}
              />
            </>
          )}
          <label className="mt-1 flex items-center gap-2 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={headphones}
              onChange={(e) => setHeadphones(e.target.checked)}
              className="h-4 w-4 accent-[#4f7cff]"
            />
            I'm wearing headphones
          </label>
          <p className="text-xs text-gray-500">
            Without headphones we enable echo cancellation so your speakers don't bleed into the recording.
          </p>
          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={recordWav}
              onChange={(e) => setRecordWav(e.target.checked)}
              className="h-4 w-4 accent-[#4f7cff]"
            />
            Studio-quality WAV audio track
          </label>
          <p className="text-xs text-gray-500">
            Records an extra uncompressed 48kHz audio track straight from your mic — the best
            source for post-production.
          </p>
          <Button onClick={join} disabled={!stream} className="mt-2">
            {joinLabel}
          </Button>
        </div>
      </Card>
    </div>
  );
}
