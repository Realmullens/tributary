import { useEffect, useRef, useState } from "react";
import { scanRecoverable, resumeUploads } from "../lib/recorder/recovery";
import type { UploadHealth } from "../lib/recorder/upload-manager";
import { formatBytes } from "./ui";

/**
 * Scans IndexedDB on load for recordings whose upload never finished
 * (crashed tab, closed browser, lost connection) and resumes them.
 */
export function RecoveryBanner() {
  const [items, setItems] = useState<Map<string, UploadHealth | null>>(new Map());
  const [done, setDone] = useState<string[]>([]);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      const recoverable = await scanRecoverable();
      if (recoverable.length === 0) return;
      setItems(new Map(recoverable.map((r) => [r.meta.localId, null])));
      resumeUploads(
        recoverable,
        (localId, health) =>
          setItems((prev) => {
            const next = new Map(prev);
            if (next.has(localId)) next.set(localId, health);
            return next;
          }),
        (localId) => {
          setItems((prev) => {
            const next = new Map(prev);
            next.delete(localId);
            return next;
          });
          setDone((prev) => [...prev, localId]);
        }
      );
    })();
  }, []);

  if (items.size === 0 && done.length === 0) return null;

  const healths = [...items.values()].filter((h): h is UploadHealth => h !== null);
  const remaining = healths.reduce((s, h) => s + (h.totalBytes - h.uploadedBytes), 0);

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 rounded-xl border border-edge bg-panel p-4 shadow-xl">
      {items.size > 0 ? (
        <>
          <h3 className="text-sm font-semibold">Recovering unfinished uploads</h3>
          <p className="mt-1 text-xs text-gray-400">
            {items.size} recording track{items.size === 1 ? "" : "s"} from a previous session
            {remaining > 0 ? ` · ${formatBytes(remaining)} left` : ""} — keep this tab open.
          </p>
          <div className="mt-2 h-1.5 overflow-hidden rounded bg-panel-2">
            <div
              className="h-full bg-accent transition-[width]"
              style={{
                width: `${
                  healths.length === 0
                    ? 0
                    : Math.round(healths.reduce((s, h) => s + h.percent, 0) / healths.length)
                }%`,
              }}
            />
          </div>
        </>
      ) : (
        <p className="text-sm text-emerald-300">Recovered uploads complete ✓</p>
      )}
    </div>
  );
}
