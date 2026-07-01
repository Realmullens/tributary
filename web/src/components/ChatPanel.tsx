import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../lib/rtc/signaling";
import { Button, Input } from "./ui";

export function ChatPanel({
  messages,
  selfId,
  onSend,
  onClose,
}: {
  messages: ChatMessage[];
  selfId: string;
  onSend: (text: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft("");
  };

  return (
    <div className="flex h-full w-72 flex-col border-l border-edge bg-panel">
      <div className="flex items-center justify-between border-b border-edge px-4 py-3">
        <h2 className="text-sm font-semibold">Chat</h2>
        <button onClick={onClose} className="text-gray-400 hover:text-white">✕</button>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3">
        {messages.length === 0 && <p className="text-xs text-gray-500">No messages yet.</p>}
        {messages.map((m, i) => (
          <div key={i} className="mb-3">
            <div className="text-xs text-gray-400">
              {m.from === selfId ? "You" : m.name}{" "}
              <span className="text-gray-600">{new Date(m.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
            </div>
            <div className="mt-0.5 whitespace-pre-wrap text-sm text-gray-100">{m.text}</div>
          </div>
        ))}
      </div>
      <div className="flex gap-2 border-t border-edge p-3">
        <Input
          value={draft}
          placeholder="Message everyone…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
        />
        <Button onClick={send} variant="ghost">Send</Button>
      </div>
    </div>
  );
}
