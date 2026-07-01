import type { Signaling } from "./signaling";

export type RemoteMedia = {
  camera: MediaStream | null;
  screen: MediaStream | null;
};

type PeerConn = {
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  /** Serializes signal processing so trickle candidates never race ahead of descriptions. */
  signalQueue: Promise<void>;
  /** Remote's announced stream-id → kind mapping (camera vs screen). */
  remoteStreamKinds: Map<string, "camera" | "screen">;
  media: RemoteMedia;
};

const FALLBACK_RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }],
};

export type TransportConfig = {
  mode: "mesh" | "livekit";
  livekitUrl?: string;
  rtc: RTCConfiguration;
};

/** Fetch transport mode + ICE servers from the server; falls back to mesh/STUN. */
export async function fetchRtcConfig(): Promise<TransportConfig> {
  try {
    const res = await fetch("/api/rtc-config");
    const data = await res.json();
    return {
      mode: data.mode === "livekit" && data.livekitUrl ? "livekit" : "mesh",
      livekitUrl: data.livekitUrl,
      rtc:
        Array.isArray(data.iceServers) && data.iceServers.length > 0
          ? { iceServers: data.iceServers }
          : FALLBACK_RTC_CONFIG,
    };
  } catch {
    return { mode: "mesh", rtc: FALLBACK_RTC_CONFIG };
  }
}

/**
 * Mesh WebRTC manager using the "perfect negotiation" pattern.
 * Streams are classified camera vs screen via announced stream ids
 * (MediaStream ids survive across the wire as msid).
 */
export class PeerManager {
  private signaling: Signaling;
  private selfId: string;
  private rtcConfig: RTCConfiguration;
  private peers = new Map<string, PeerConn>();
  private cameraStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;
  private onMediaChange: (participantId: string, media: RemoteMedia) => void;
  private watchdogs = new Map<string, number>();
  private rebuildAttempts = new Map<string, number>();

  constructor(
    signaling: Signaling,
    selfId: string,
    onMediaChange: (participantId: string, media: RemoteMedia) => void,
    rtcConfig: RTCConfiguration = FALLBACK_RTC_CONFIG
  ) {
    this.signaling = signaling;
    this.selfId = selfId;
    this.onMediaChange = onMediaChange;
    this.rtcConfig = rtcConfig;
  }

  setCameraStream(stream: MediaStream | null): void {
    this.cameraStream = stream;
    for (const [id] of this.peers) this.syncTracks(id);
    this.announceStreams();
  }

  setScreenStream(stream: MediaStream | null): void {
    this.screenStream = stream;
    for (const [id] of this.peers) this.syncTracks(id);
    this.announceStreams();
  }

  addPeer(participantId: string): void {
    if (this.peers.has(participantId)) return;
    const polite = this.selfId < participantId;
    const pc = new RTCPeerConnection(this.rtcConfig);
    const conn: PeerConn = {
      pc,
      polite,
      makingOffer: false,
      ignoreOffer: false,
      signalQueue: Promise.resolve(),
      remoteStreamKinds: new Map(),
      media: { camera: null, screen: null },
    };
    this.peers.set(participantId, conn);

    pc.onnegotiationneeded = async () => {
      try {
        conn.makingOffer = true;
        await pc.setLocalDescription();
        this.signaling.sendSignal(participantId, { description: pc.localDescription });
      } catch (err) {
        console.error("negotiation failed", err);
      } finally {
        conn.makingOffer = false;
      }
    };

    pc.onicecandidate = (event) => {
      this.signaling.sendSignal(participantId, { candidate: event.candidate });
    };

    pc.ontrack = (event) => {
      const stream = event.streams[0];
      if (!stream) return;
      const classify = () => {
        const kind = conn.remoteStreamKinds.get(stream.id) ?? "camera";
        conn.media = { ...conn.media, [kind]: stream };
        this.onMediaChange(participantId, conn.media);
      };
      classify();
      stream.onremovetrack = () => {
        if (stream.getTracks().length === 0) {
          for (const kind of ["camera", "screen"] as const) {
            if (conn.media[kind] === stream) conn.media = { ...conn.media, [kind]: null };
          }
          this.onMediaChange(participantId, conn.media);
        }
      };
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        this.clearWatchdog(participantId);
        this.rebuildAttempts.delete(participantId);
      } else if (pc.connectionState === "failed") {
        pc.restartIce();
        this.armWatchdog(participantId);
      }
    };

    this.syncTracks(participantId);
    this.announceStreams(participantId);
    this.armWatchdog(participantId);
  }

  /**
   * ICE agents can stall (never gather, never leave "connecting"). If a peer
   * hasn't connected within the window, tear the connection down and rebuild —
   * the fresh offer lands on the remote's existing connection as an ICE restart.
   */
  private armWatchdog(participantId: string): void {
    this.clearWatchdog(participantId);
    const timer = window.setTimeout(() => {
      const conn = this.peers.get(participantId);
      if (!conn || conn.pc.connectionState === "connected") return;
      const attempt = (this.rebuildAttempts.get(participantId) ?? 0) + 1;
      if (attempt > 4) return; // give up; peer is likely truly unreachable
      this.rebuildAttempts.set(participantId, attempt);
      console.warn(`[rtc] connection to ${participantId} stalled (${conn.pc.connectionState}); rebuilding, attempt ${attempt}`);
      this.removePeer(participantId);
      this.addPeer(participantId);
    }, 10_000);
    this.watchdogs.set(participantId, timer);
  }

  private clearWatchdog(participantId: string): void {
    const timer = this.watchdogs.get(participantId);
    if (timer !== undefined) window.clearTimeout(timer);
    this.watchdogs.delete(participantId);
  }

  removePeer(participantId: string): void {
    this.clearWatchdog(participantId);
    const conn = this.peers.get(participantId);
    if (!conn) return;
    conn.pc.close();
    this.peers.delete(participantId);
    this.onMediaChange(participantId, { camera: null, screen: null });
  }

  closeAll(): void {
    for (const [id] of this.peers) this.clearWatchdog(id);
    for (const conn of this.peers.values()) conn.pc.close();
    this.peers.clear();
  }

  /** Keep each connection's senders matched to current local streams. */
  private syncTracks(participantId: string): void {
    const conn = this.peers.get(participantId);
    if (!conn) return;
    const wanted: { track: MediaStreamTrack; stream: MediaStream }[] = [];
    if (this.cameraStream) {
      for (const track of this.cameraStream.getTracks()) wanted.push({ track, stream: this.cameraStream });
    }
    if (this.screenStream) {
      for (const track of this.screenStream.getTracks()) wanted.push({ track, stream: this.screenStream });
    }
    const senders = conn.pc.getSenders();
    for (const sender of senders) {
      if (sender.track && !wanted.some((w) => w.track === sender.track)) {
        conn.pc.removeTrack(sender);
      }
    }
    for (const { track, stream } of wanted) {
      if (!senders.some((s) => s.track === track)) {
        conn.pc.addTrack(track, stream);
      }
    }
  }

  /** Tell peers which of our stream ids is the camera vs the screen share. */
  private announceStreams(participantId?: string): void {
    const data = {
      streamKinds: {
        ...(this.cameraStream ? { [this.cameraStream.id]: "camera" } : {}),
        ...(this.screenStream ? { [this.screenStream.id]: "screen" } : {}),
      },
    };
    if (participantId) this.signaling.sendSignal(participantId, data);
    else for (const [id] of this.peers) this.signaling.sendSignal(id, data);
  }

  handleSignal(from: string, data: any): void {
    let conn = this.peers.get(from);
    if (!conn) {
      this.addPeer(from);
      conn = this.peers.get(from)!;
    }
    // Process strictly in arrival order: an offer/answer must be fully applied
    // before the candidates that followed it on the wire are added.
    conn.signalQueue = conn.signalQueue.then(() => this.processSignal(conn!, from, data));
  }

  private async processSignal(conn: PeerConn, from: string, data: any): Promise<void> {
    const { pc } = conn;
    if (pc.connectionState === "closed") return;

    if (data.streamKinds) {
      conn.remoteStreamKinds = new Map(Object.entries(data.streamKinds) as ["camera" | "screen"][] & any);
      // Re-classify any streams that arrived before the announcement.
      for (const kind of ["camera", "screen"] as const) {
        const stream = conn.media[kind];
        if (stream) {
          const actual = conn.remoteStreamKinds.get(stream.id) ?? kind;
          if (actual !== kind) {
            conn.media = { ...conn.media, [kind]: null, [actual]: stream };
          }
        }
      }
      this.onMediaChange(from, conn.media);
      return;
    }

    try {
      if (data.description) {
        const description: RTCSessionDescriptionInit = data.description;
        const offerCollision =
          description.type === "offer" && (conn.makingOffer || pc.signalingState !== "stable");
        conn.ignoreOffer = !conn.polite && offerCollision;
        if (conn.ignoreOffer) return;
        await pc.setRemoteDescription(description);
        if (description.type === "offer") {
          await pc.setLocalDescription();
          this.signaling.sendSignal(from, { description: pc.localDescription });
        }
      } else if (data.candidate !== undefined) {
        try {
          await pc.addIceCandidate(data.candidate ?? undefined);
        } catch (err) {
          if (!conn.ignoreOffer) throw err;
        }
      }
    } catch (err) {
      console.error("signal handling failed", err);
    }
  }
}
