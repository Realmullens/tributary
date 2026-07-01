import type { UploadHealth } from "../recorder/upload-manager";

export type PeerState = { mic: boolean; cam: boolean; sharing: boolean };

export type Peer = {
  participantId: string;
  name: string;
  role: "host" | "guest";
  state: PeerState;
  upload: UploadHealth | null;
};

export type ChatMessage = { from: string; name: string; text: string; at: number };

export type WelcomeExtras = {
  teleprompter: string | null;
  waiting?: Peer[];
};

export type SignalingEvents = {
  onWelcome: (
    self: Peer,
    peers: Peer[],
    recording: { recordingId: string; startedAtMs: number } | null,
    extras: WelcomeExtras
  ) => void;
  onPeerJoined: (peer: Peer) => void;
  onPeerLeft: (participantId: string) => void;
  onWaitingRoom?: () => void;
  onDeclined?: () => void;
  onWaitingGuest?: (peer: Peer) => void;
  onWaitingLeft?: (participantId: string) => void;
  onForceMute?: () => void;
  onTeleprompter?: (script: string) => void;
  onLiveChanged?: (live: boolean) => void;
  onSignal: (from: string, data: any) => void;
  onPeerState: (participantId: string, state: PeerState) => void;
  onPeerUpload: (participantId: string, health: UploadHealth | null) => void;
  onChat: (msg: ChatMessage) => void;
  onRecordingStarted: (recordingId: string, startedAtMs: number) => void;
  onRecordingStopped: (recordingId: string, stoppedAtMs: number) => void;
  onRecordingCountdown?: (seconds: number, startsAtMs: number) => void;
  onRecordingCountdownCancelled?: () => void;
  onTrackStatus?: (trackId: string, status: string) => void;
  onExportStatus?: (exportId: string, status: string) => void;
  onReplaced?: () => void;
  onConnectionChange?: (connected: boolean) => void;
};

/**
 * WebSocket signaling client with auto-reconnect and NTP-style clock offset
 * estimation (used to map local recorder start times onto the server clock).
 */
export class Signaling {
  private token: string;
  private events: SignalingEvents;
  private ws: WebSocket | null = null;
  private closed = false;
  private pingTimer: number | null = null;
  private reconnectDelay = 1000;
  /** Best estimate of (serverClock − localClock); refined by low-RTT pings. */
  clockOffsetMs = 0;
  private bestRtt = Number.POSITIVE_INFINITY;
  private lastPingSentAt = 0;

  constructor(token: string, events: SignalingEvents) {
    this.token = token;
    this.events = events;
  }

  connect(): void {
    if (this.closed) return;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws?token=${this.token}`);
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectDelay = 1000;
      this.events.onConnectionChange?.(true);
      this.sendPing();
      this.pingTimer = window.setInterval(() => this.sendPing(), 5000);
    };

    ws.onmessage = (event) => this.handleMessage(JSON.parse(event.data));

    ws.onclose = (event) => {
      if (this.pingTimer) window.clearInterval(this.pingTimer);
      this.pingTimer = null;
      this.events.onConnectionChange?.(false);
      if (event.code === 4000) {
        // Another tab/device took over this participant.
        this.closed = true;
        this.events.onReplaced?.();
        return;
      }
      if (event.code === 4403) {
        // Host declined entry from the waiting room.
        this.closed = true;
        this.events.onDeclined?.();
        return;
      }
      if (!this.closed) {
        setTimeout(() => this.connect(), this.reconnectDelay);
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 15_000);
      }
    };
  }

  close(): void {
    this.closed = true;
    if (this.pingTimer) window.clearInterval(this.pingTimer);
    this.ws?.close();
  }

  send(msg: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  sendSignal(to: string, data: unknown): void {
    this.send({ t: "signal", to, data });
  }

  sendState(state: PeerState): void {
    this.send({ t: "state", ...state });
  }

  sendChat(text: string): void {
    this.send({ t: "chat", text });
  }

  sendUploadHealth(health: UploadHealth | null): void {
    this.send({ t: "upload", health });
  }

  sendAdmit(participantId: string): void {
    this.send({ t: "admit", participantId });
  }

  sendDecline(participantId: string): void {
    this.send({ t: "decline", participantId });
  }

  sendForceMute(participantId: string): void {
    this.send({ t: "force-mute", participantId });
  }

  sendTeleprompter(script: string): void {
    this.send({ t: "teleprompter-set", script });
  }

  private sendPing(): void {
    this.lastPingSentAt = Date.now();
    this.send({ t: "ping", now: this.lastPingSentAt });
  }

  private handleMessage(msg: any): void {
    switch (msg.t) {
      case "welcome":
        this.events.onWelcome(msg.self, msg.peers, msg.recording, {
          teleprompter: msg.teleprompter ?? null,
          waiting: msg.waiting,
        });
        break;
      case "waiting-room":
        this.events.onWaitingRoom?.();
        break;
      case "declined":
        this.events.onDeclined?.();
        break;
      case "waiting-guest":
        this.events.onWaitingGuest?.(msg.peer);
        break;
      case "waiting-left":
        this.events.onWaitingLeft?.(msg.participantId);
        break;
      case "force-mute":
        this.events.onForceMute?.();
        break;
      case "teleprompter":
        this.events.onTeleprompter?.(msg.script ?? "");
        break;
      case "live-started":
        this.events.onLiveChanged?.(true);
        break;
      case "live-stopped":
        this.events.onLiveChanged?.(false);
        break;
      case "peer-joined":
        this.events.onPeerJoined(msg.peer);
        break;
      case "peer-left":
        this.events.onPeerLeft(msg.participantId);
        break;
      case "signal":
        this.events.onSignal(msg.from, msg.data);
        break;
      case "state":
        this.events.onPeerState(msg.participantId, msg.state);
        break;
      case "upload":
        this.events.onPeerUpload(msg.participantId, msg.health);
        break;
      case "chat":
        this.events.onChat(msg);
        break;
      case "recording-started":
        this.events.onRecordingStarted(msg.recordingId, msg.startedAtMs);
        break;
      case "recording-stopped":
        this.events.onRecordingStopped(msg.recordingId, msg.stoppedAtMs);
        break;
      case "recording-countdown":
        this.events.onRecordingCountdown?.(msg.seconds, msg.startsAtMs);
        break;
      case "recording-countdown-cancelled":
        this.events.onRecordingCountdownCancelled?.();
        break;
      case "track-status":
        this.events.onTrackStatus?.(msg.trackId, msg.status);
        break;
      case "export-status":
        this.events.onExportStatus?.(msg.exportId, msg.status);
        break;
      case "pong": {
        const now = Date.now();
        const rtt = now - msg.clientNow;
        // Keep the offset from the lowest-RTT sample — least skewed by queueing.
        if (rtt < this.bestRtt + 10) {
          this.bestRtt = Math.min(rtt, this.bestRtt);
          this.clockOffsetMs = msg.serverNow + rtt / 2 - now;
        }
        break;
      }
    }
  }
}
