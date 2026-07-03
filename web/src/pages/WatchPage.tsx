import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import Hls from "hls.js";

type WatchInfo = { title: string; live: boolean; hlsUrl: string | null };

/** Public live watch page — no account needed, just the watch link. */
export function WatchPage() {
  const { watchToken } = useParams<{ watchToken: string }>();
  const [info, setInfo] = useState<WatchInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);

  // Poll status: picks the stream up when it starts, notices when it ends.
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/watch/${watchToken}`);
        if (!res.ok) {
          setError("This watch link is invalid.");
          return;
        }
        const data = (await res.json()) as WatchInfo;
        if (!cancelled) setInfo((prev) => (JSON.stringify(prev) === JSON.stringify(data) ? prev : data));
      } catch {
        /* transient */
      }
    };
    void poll();
    const timer = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [watchToken]);

  // Attach/detach the HLS player as the stream comes and goes.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !info?.live || !info.hlsUrl) {
      hlsRef.current?.destroy();
      hlsRef.current = null;
      return;
    }
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = info.hlsUrl; // Safari native HLS
      void video.play().catch(() => {});
      return;
    }
    if (Hls.isSupported()) {
      const hls = new Hls({ liveSyncDurationCount: 3 });
      hlsRef.current = hls;
      hls.loadSource(info.hlsUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => void video.play().catch(() => {}));
      hls.on(Hls.Events.ERROR, (_event, data) => {
        // Live edges are racy (rotating segments); recover instead of dying.
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
        else {
          hls.stopLoad();
          setTimeout(() => hls.loadSource(info.hlsUrl!), 3000);
        }
      });
      return () => {
        hls.destroy();
        hlsRef.current = null;
      };
    }
    setError("This browser can't play HLS streams.");
  }, [info?.live, info?.hlsUrl]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink p-6 text-sm text-gray-400">
        {error}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-ink">
      <header className="flex items-center justify-between gap-3 border-b border-edge bg-panel px-6 py-3">
        <div className="flex min-w-0 items-baseline gap-3">
          <span className="bg-gradient-to-r from-accent-2 to-accent bg-clip-text text-2xl font-bold tracking-tight text-transparent">
            Tributary
          </span>
          <h1 className="truncate text-sm text-gray-400">{info?.title ?? "…"}</h1>
        </div>
        {info?.live ? (
          <span className="flex shrink-0 items-center gap-2 rounded-full bg-rec/15 px-3 py-1 text-sm font-medium text-rec">
            <span className="h-2 w-2 animate-pulse rounded-full bg-rec" /> LIVE
          </span>
        ) : (
          <span className="text-sm text-gray-500">Offline</span>
        )}
      </header>
      <main className="flex min-h-[calc(100vh-57px)] items-center justify-center p-6">
        <div className="w-full max-w-4xl">
          <div className="mb-4">
            <h2 className="text-2xl font-bold tracking-tight">{info?.title ?? "…"}</h2>
            <p className="mt-1 text-sm text-gray-400">
              {info?.live ? "Live broadcast" : "Waiting for the host to start the stream."}
            </p>
          </div>
          <div
            className="overflow-hidden rounded-2xl bg-panel-2 ring-1 ring-edge"
            style={{ aspectRatio: "16 / 9" }}
          >
            {info?.live ? (
              <video ref={videoRef} controls playsInline className="h-full w-full" />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-gray-500">
                The stream hasn't started yet - this page will update automatically.
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
