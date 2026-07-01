import { useEffect, useRef, useState } from "react";
import type { UploadHealth } from "../lib/recorder/upload-manager";
import { Badge } from "./ui";

export function VideoTile({
  stream,
  name,
  muted,
  micOn,
  camOn,
  isSelf,
  upload,
  large,
  onHostMute,
}: {
  stream: MediaStream | null;
  name: string;
  muted?: boolean;
  micOn?: boolean;
  camOn?: boolean;
  isSelf?: boolean;
  upload?: UploadHealth | null;
  large?: boolean;
  /** Present when the local user is a host viewing a guest tile. */
  onHostMute?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [volume, setVolume] = useState(1);

  useEffect(() => {
    if (videoRef.current && videoRef.current.srcObject !== stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.volume = volume;
  }, [volume, stream]);

  return (
    <div
      className={`group relative overflow-hidden rounded-xl bg-panel-2 border border-edge ${
        large ? "col-span-full" : ""
      }`}
      style={{ aspectRatio: "16 / 9" }}
    >
      {stream && camOn !== false ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={muted || isSelf}
          className={`h-full w-full object-cover ${isSelf ? "scale-x-[-1]" : ""}`}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-edge text-2xl font-semibold text-gray-300">
            {name.slice(0, 1).toUpperCase()}
          </div>
        </div>
      )}
      <div className="absolute bottom-2 left-2 flex items-center gap-2">
        <span className="rounded-md bg-black/60 px-2 py-0.5 text-xs text-white">
          {name} {isSelf ? "(you)" : ""}
        </span>
        {micOn === false && <Badge tone="red">muted</Badge>}
      </div>
      {upload && upload.state !== "complete" && (
        <div className="absolute top-2 right-2">
          <Badge tone={upload.state === "delayed" || upload.state === "failed" ? "red" : "blue"}>
            ⇡ {upload.percent}%
          </Badge>
        </div>
      )}
      {!isSelf && (
        <div className="absolute bottom-2 right-2 flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
          {onHostMute && micOn !== false && (
            <button
              onClick={onHostMute}
              title={`Mute ${name} for everyone`}
              className="rounded-md bg-black/60 px-2 py-0.5 text-xs text-white hover:bg-rec/80"
            >
              Mute
            </button>
          )}
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            title="Your local volume for this person"
            onChange={(e) => setVolume(Number(e.target.value))}
            className="w-20 accent-[#4f7cff]"
          />
        </div>
      )}
    </div>
  );
}
