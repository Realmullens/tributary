export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; token?: string } = {}
): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.token) headers["Authorization"] = `Bearer ${options.token}`;
  const res = await fetch(path, {
    method: options.method ?? (options.body !== undefined ? "POST" : "GET"),
    headers,
    credentials: "include",
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as any)?.error ?? `Request failed (${res.status})`);
  return data as T;
}

export type User = { id: string; email: string; name: string };
export type Studio = { id: string; name: string; created_at: number; session_count?: number };
export type Session = {
  id: string;
  studio_id: string;
  title: string;
  status: string;
  invite_token: string;
  created_at: number;
  ended_at: number | null;
  auto_record?: number;
  waiting_room?: number;
};
export type Recording = {
  id: string;
  session_id: string;
  started_at_ms: number;
  stopped_at_ms: number | null;
  status: string;
};
export type Track = {
  id: string;
  recording_id: string;
  participant_id: string;
  participant_name?: string;
  type: "camera" | "screen" | "pcm";
  mime_type: string;
  status: string;
  start_offset_ms: number;
  duration_ms: number | null;
  size_bytes: number;
  final_chunk_count: number | null;
  received_chunks?: number;
  width: number | null;
  height: number | null;
  error: string | null;
  created_at: number;
};
export type ExportItem = {
  id: string;
  recording_id: string;
  type: "mixed_video" | "mixed_audio";
  status: string;
  format: string;
  size_bytes: number | null;
  duration_ms: number | null;
  error: string | null;
  created_at: number;
};
export type TranscriptSummary = {
  id: string;
  recording_id: string;
  status: string;
  language: string | null;
  error: string | null;
  created_at: number;
};
export type TranscriptSegment = {
  startMs: number;
  endMs: number;
  text: string;
  speaker: string;
  trackId: string;
};
export type ParticipantInfo = { id: string; name: string; role: "host" | "guest" };
export type SessionParticipant = {
  id: string;
  name: string;
  role: string;
  joined_at: number | null;
  left_at: number | null;
};
