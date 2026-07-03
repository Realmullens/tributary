import { useEffect, useRef, useState } from "react";
import type { UploadHealth } from "../lib/recorder/upload-manager";
import { Badge } from "./ui";
import { MicOffIcon } from "./icons";

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
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [volume, setVolume] = useState(1);

  const attachVideo = (el: HTMLVideoElement | null) => {
    videoRef.current = el;
    if (el && el.srcObject !== stream) el.srcObject = stream;
  };

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
      className={`group relative overflow-hidden rounded-2xl bg-panel-2 ring-1 ring-edge ${
        large ? "col-span-full" : ""
      }`}
      style={{ aspectRatio: "16 / 9" }}
    >
      {stream && (
        <video
          ref={attachVideo}
          autoPlay
          playsInline
          muted={muted || isSelf}
          className={`h-full w-full object-cover ${isSelf ? "scale-x-[-1]" : ""} ${
            camOn === false ? "hidden" : ""
          }`}
        />
      )}
      {(!stream || camOn === false) && (
        <div className="flex h-full w-full items-center justify-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-accent to-accent-2/60 text-3xl font-semibold text-white">
            {name.slice(0, 1).toUpperCase()}
          </div>
        </div>
      )}
      <div className="absolute bottom-2.5 left-2.5 flex items-center gap-1.5">
        {micOn === false && (
          <span
            role="img"
            aria-label={`${name} is muted`}
            title={`${name} is muted`}
            className="flex h-6 w-6 items-center justify-center rounded-full bg-rec text-white"
          >
            <MicOffIcon width={13} height={13} />
          </span>
        )}
        <span className="rounded-full bg-black/60 px-2.5 py-1 text-xs font-medium text-white backdrop-blur-sm">
          {name}
          {isSelf ? " (you)" : ""}
        </span>
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
