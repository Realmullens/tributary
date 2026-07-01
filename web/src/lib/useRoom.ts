import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type ParticipantInfo } from "./api";
import { RecordingEngine, type QualityPreset } from "./recorder/recorder";
import type { UploadHealth } from "./recorder/upload-manager";
import { fetchRtcConfig, PeerManager, type RemoteMedia } from "./rtc/peers";
import { LiveKitManager } from "./rtc/livekit";
import { Signaling, type ChatMessage, type Peer, type PeerState } from "./rtc/signaling";

export type RoomPeer = Peer & { media: RemoteMedia };

export type RoomConfig = {
  sessionId: string;
  participant: ParticipantInfo;
  token: string;
  isHost: boolean;
  preset: QualityPreset;
  recordWav: boolean;
  cameraStream: MediaStream;
};

export type RecordingState = { recordingId: string; startedAtMs: number } | null;

export function useRoom(config: RoomConfig) {
  const [peers, setPeers] = useState<Map<string, RoomPeer>>(new Map());
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [recording, setRecording] = useState<RecordingState>(null);
  const [countdownEndsAt, setCountdownEndsAt] = useState<number | null>(null);
  const [uploadsPaused, setUploadsPaused] = useState(false);
  const [myUpload, setMyUpload] = useState<UploadHealth | null>(null);
  const [connected, setConnected] = useState(false);
  const [replaced, setReplaced] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [declined, setDeclined] = useState(false);
  const [waitingGuests, setWaitingGuests] = useState<Peer[]>([]);
  const [teleprompter, setTeleprompter] = useState("");
  const [error, setError] = useState<string | null>(null);

  const signalingRef = useRef<Signaling | null>(null);
  const peerManagerRef = useRef<PeerManager | null>(null);
  const livekitRef = useRef<LiveKitManager | null>(null);
  const engineRef = useRef<RecordingEngine | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const recordingRef = useRef<RecordingState>(null);
  const lastHealthSentAt = useRef(0);

  const updatePeer = useCallback((participantId: string, patch: Partial<RoomPeer>) => {
    setPeers((prev) => {
      const existing = prev.get(participantId);
      if (!existing) return prev;
      const next = new Map(prev);
      next.set(participantId, { ...existing, ...patch });
      return next;
    });
  }, []);

  useEffect(() => {
    const engine = new RecordingEngine({
      sessionId: config.sessionId,
      participantToken: config.token,
      preset: config.preset,
      onAggregateHealth: (health) => {
        setMyUpload(health);
        const now = Date.now();
        if (now - lastHealthSentAt.current > 1000 || health.state === "complete") {
          lastHealthSentAt.current = now;
          signalingRef.current?.sendUploadHealth(health);
        }
      },
      onError: (message) => setError(message),
    });
    engineRef.current = engine;

    const rtcConfigPromise = fetchRtcConfig();
    const signaling = new Signaling(config.token, {
      onWelcome: async (_self, existingPeers, activeRecording, extras) => {
        setWaiting(false);
        setTeleprompter(extras.teleprompter ?? "");
        if (extras.waiting) setWaitingGuests(extras.waiting);
        const transportConfig = await rtcConfigPromise;
        const onMedia = (pid: string, media: RemoteMedia) => updatePeer(pid, { media });

        if (transportConfig.mode === "livekit" && transportConfig.livekitUrl && !livekitRef.current) {
          // SFU mode: LiveKit carries media; everything else stays on our WS.
          const lk = new LiveKitManager(transportConfig.livekitUrl, config.token, onMedia);
          livekitRef.current = lk;
          lk.setCameraStream(config.cameraStream);
          if (screenStreamRef.current) void lk.setScreenStream(screenStreamRef.current);
          lk.connect().catch((err) =>
            setError(`Live call (SFU) failed: ${err instanceof Error ? err.message : err}`)
          );
        } else if (transportConfig.mode === "mesh") {
          const pm = new PeerManager(signaling, config.participant.id, onMedia, transportConfig.rtc);
          peerManagerRef.current = pm;
          pm.setCameraStream(config.cameraStream);
          if (screenStreamRef.current) pm.setScreenStream(screenStreamRef.current);
        }

        setPeers(() => {
          const map = new Map<string, RoomPeer>();
          for (const peer of existingPeers) {
            map.set(peer.participantId, { ...peer, media: { camera: null, screen: null } });
            peerManagerRef.current?.addPeer(peer.participantId); // mesh: newcomer initiates offers
          }
          return map;
        });
        signaling.sendState(currentState());

        if (activeRecording && !recordingRef.current) {
          beginLocalRecording(activeRecording.recordingId, activeRecording.startedAtMs);
        }
      },
      onPeerJoined: (peer) => {
        setPeers((prev) => {
          const next = new Map(prev);
          next.set(peer.participantId, { ...peer, media: { camera: null, screen: null } });
          return next;
        });
      },
      onPeerLeft: (participantId) => {
        peerManagerRef.current?.removePeer(participantId);
        setPeers((prev) => {
          const next = new Map(prev);
          next.delete(participantId);
          return next;
        });
      },
      onSignal: (from, data) => {
        void peerManagerRef.current?.handleSignal(from, data);
      },
      onPeerState: (participantId, state: PeerState) => updatePeer(participantId, { state }),
      onPeerUpload: (participantId, health) => updatePeer(participantId, { upload: health }),
      onChat: (msg) => setChat((prev) => [...prev.slice(-199), msg]),
      onRecordingStarted: (recordingId, startedAtMs) => {
        setCountdownEndsAt(null);
        beginLocalRecording(recordingId, startedAtMs);
      },
      onRecordingStopped: () => {
        engineRef.current?.stopAll();
        recordingRef.current = null;
        setRecording(null);
      },
      onRecordingCountdown: (_seconds, startsAtMs) => setCountdownEndsAt(startsAtMs),
      onRecordingCountdownCancelled: () => setCountdownEndsAt(null),
      onWaitingRoom: () => setWaiting(true),
      onDeclined: () => setDeclined(true),
      onWaitingGuest: (peer) =>
        setWaitingGuests((prev) =>
          prev.some((p) => p.participantId === peer.participantId) ? prev : [...prev, peer]
        ),
      onWaitingLeft: (participantId) =>
        setWaitingGuests((prev) => prev.filter((p) => p.participantId !== participantId)),
      onForceMute: () => {
        for (const track of config.cameraStream.getAudioTracks()) track.enabled = false;
        setMicOn(false);
        signalingRef.current?.sendState({
          mic: false,
          cam: config.cameraStream.getVideoTracks().some((t) => t.enabled),
          sharing: Boolean(screenStreamRef.current),
        });
        setError("The host muted your microphone.");
      },
      onTeleprompter: (script) => setTeleprompter(script),
      onReplaced: () => setReplaced(true),
      onConnectionChange: setConnected,
    });
    signalingRef.current = signaling;
    signaling.connect();

    function currentState(): PeerState {
      return {
        mic: config.cameraStream.getAudioTracks().some((t) => t.enabled),
        cam: config.cameraStream.getVideoTracks().some((t) => t.enabled),
        sharing: Boolean(screenStreamRef.current),
      };
    }

    function beginLocalRecording(recordingId: string, startedAtMs: number) {
      const state = { recordingId, startedAtMs };
      recordingRef.current = state;
      setRecording(state);
      void engine.startTrack(
        recordingId,
        startedAtMs,
        signaling.clockOffsetMs,
        "camera",
        config.cameraStream
      );
      if (config.recordWav) {
        void engine.startPcmTrack(recordingId, startedAtMs, signaling.clockOffsetMs, config.cameraStream);
      }
      if (screenStreamRef.current) {
        void engine.startTrack(
          recordingId,
          startedAtMs,
          signaling.clockOffsetMs,
          "screen",
          screenStreamRef.current
        );
      }
    }

    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (engineRef.current?.isRecording || engineRef.current?.hasPendingUploads()) {
        event.preventDefault();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);

    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      engine.stopAll();
      signaling.close();
      peerManagerRef.current?.closeAll();
      livekitRef.current?.close();
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.sessionId, config.token]);

  const sendState = useCallback(() => {
    signalingRef.current?.sendState({
      mic: config.cameraStream.getAudioTracks().some((t) => t.enabled),
      cam: config.cameraStream.getVideoTracks().some((t) => t.enabled),
      sharing: Boolean(screenStreamRef.current),
    });
  }, [config.cameraStream]);

  const toggleMic = useCallback(() => {
    for (const track of config.cameraStream.getAudioTracks()) track.enabled = !track.enabled;
    setMicOn(config.cameraStream.getAudioTracks().some((t) => t.enabled));
    sendState();
  }, [config.cameraStream, sendState]);

  const toggleCam = useCallback(() => {
    for (const track of config.cameraStream.getVideoTracks()) track.enabled = !track.enabled;
    setCamOn(config.cameraStream.getVideoTracks().some((t) => t.enabled));
    sendState();
  }, [config.cameraStream, sendState]);

  const stopShare = useCallback(() => {
    engineRef.current?.stopTracksOfKind("screen");
    const stream = screenStreamRef.current;
    screenStreamRef.current = null;
    setScreenStream(null);
    peerManagerRef.current?.setScreenStream(null);
    void livekitRef.current?.setScreenStream(null);
    stream?.getTracks().forEach((t) => t.stop());
    sendState();
  }, [sendState]);

  const startShare = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30 } },
        audio: true,
      });
      screenStreamRef.current = stream;
      setScreenStream(stream);
      peerManagerRef.current?.setScreenStream(stream);
      void livekitRef.current?.setScreenStream(stream);
      sendState();
      stream.getVideoTracks()[0]?.addEventListener("ended", () => stopShare());
      const rec = recordingRef.current;
      if (rec && engineRef.current && signalingRef.current) {
        void engineRef.current.startTrack(
          rec.recordingId,
          rec.startedAtMs,
          signalingRef.current.clockOffsetMs,
          "screen",
          stream
        );
      }
    } catch {
      // user cancelled the picker
    }
  }, [sendState, stopShare]);

  const startRecording = useCallback(async () => {
    setError(null);
    try {
      await api(`/api/sessions/${config.sessionId}/recording/start`, { body: {} });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start recording");
    }
  }, [config.sessionId]);

  const stopRecording = useCallback(async () => {
    try {
      await api(`/api/sessions/${config.sessionId}/recording/stop`, { body: {} });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not stop recording");
    }
  }, [config.sessionId]);

  const sendChat = useCallback((text: string) => {
    signalingRef.current?.sendChat(text);
  }, []);

  const admitGuest = useCallback((participantId: string) => {
    signalingRef.current?.sendAdmit(participantId);
  }, []);

  const declineGuest = useCallback((participantId: string) => {
    signalingRef.current?.sendDecline(participantId);
  }, []);

  const muteGuest = useCallback((participantId: string) => {
    signalingRef.current?.sendForceMute(participantId);
  }, []);

  const saveTeleprompter = useCallback((script: string) => {
    setTeleprompter(script);
    signalingRef.current?.sendTeleprompter(script);
  }, []);

  const toggleUploadsPaused = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const next = !engine.isUploadsPaused;
    engine.setUploadsPaused(next);
    setUploadsPaused(next);
  }, []);

  const peerList = useMemo(() => [...peers.values()], [peers]);

  return {
    peers: peerList,
    chat,
    sendChat,
    micOn,
    camOn,
    toggleMic,
    toggleCam,
    screenStream,
    startShare,
    stopShare,
    recording,
    countdownEndsAt,
    startRecording,
    stopRecording,
    uploadsPaused,
    toggleUploadsPaused,
    myUpload,
    connected,
    replaced,
    waiting,
    declined,
    waitingGuests,
    admitGuest,
    declineGuest,
    muteGuest,
    teleprompter,
    saveTeleprompter,
    error,
    dismissError: () => setError(null),
  };
}
