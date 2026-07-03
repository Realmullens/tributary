import { useEffect, useRef, useState } from "react";
import { Button } from "./ui";

/**
 * Auto-scrolling script overlay. The host edits the script (synced to everyone
 * via the session); each participant controls their own scroll speed/font.
 */
export function Teleprompter({
  script,
  canEdit,
  onSave,
  onClose,
}: {
  script: string;
  canEdit: boolean;
  onSave: (script: string) => void;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(script);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(40); // px per second
  const [fontSize, setFontSize] = useState(28);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);
  const lastTsRef = useRef(0);

  useEffect(() => setDraft(script), [script]);

  useEffect(() => {
    if (!playing) return;
    lastTsRef.current = 0;
    const tick = (ts: number) => {
      if (lastTsRef.current) {
        const el = scrollRef.current;
        if (el) {
          el.scrollTop += (speed * (ts - lastTsRef.current)) / 1000;
          if (el.scrollTop + el.clientHeight >= el.scrollHeight - 1) setPlaying(false);
        }
      }
      lastTsRef.current = ts;
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, speed]);

  const restart = () => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    setPlaying(false);
  };

  return (
    <div className="flex h-full w-80 flex-col border-l border-edge bg-panel">
      <div className="flex items-center justify-between border-b border-edge px-4 py-3">
        <h2 className="text-sm font-semibold">Teleprompter</h2>
        <button onClick={onClose} className="text-gray-400 hover:text-white">
          ✕
        </button>
      </div>

      {editing ? (
        <>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Paste your script, questions, or talking points…"
            className="flex-1 resize-none bg-panel-2 p-4 text-sm text-gray-100 outline-none focus:ring-1 focus:ring-accent"
          />
          <div className="flex gap-2 border-t border-edge p-3">
            <Button
              onClick={() => {
                onSave(draft);
                setEditing(false);
              }}
            >
              Save script
            </Button>
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </>
      ) : (
        <>
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto px-5 py-6 leading-relaxed text-gray-100"
            style={{ fontSize }}
          >
            {script ? (
              <div className="whitespace-pre-wrap pb-[60vh]">{script}</div>
            ) : (
              <p className="text-sm text-gray-500">
                No script yet.{canEdit ? " Click Edit to add one — guests see it too." : " The host hasn't added one."}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-2 border-t border-edge p-3">
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={() => setPlaying((p) => !p)} disabled={!script}>
                {playing ? "Pause" : "Play"}
              </Button>
              <Button variant="ghost" onClick={restart} disabled={!script}>Restart</Button>
              {canEdit && (
                <Button variant="ghost" onClick={() => setEditing(true)}>Edit</Button>
              )}
            </div>
            <label className="flex items-center gap-2 text-xs text-gray-400">
              Speed
              <input
                type="range"
                min={10}
                max={150}
                value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))}
                className="flex-1 accent-accent"
              />
            </label>
            <label className="flex items-center gap-2 text-xs text-gray-400">
              Font
              <input
                type="range"
                min={16}
                max={56}
                value={fontSize}
                onChange={(e) => setFontSize(Number(e.target.value))}
                className="flex-1 accent-accent"
              />
            </label>
          </div>
        </>
      )}
    </div>
  );
}
