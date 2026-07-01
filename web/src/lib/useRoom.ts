import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type ParticipantInfo } from "./api";
import { RecordingEngine, type QualityPreset } from "./recorder/recorder";
import type { UploadHealth } from "./recorder/upload-manager";
import { PeerManager, type RemoteMedia } from "./rtc/peers";
import { Signaling, type ChatMessage, type Peer, type PeerState } from "./rtc/signaling";

export type RoomPeer = Peer & { media: RemoteMedia };

export type RoomConfig = {
  sessionId: string;
  participant: ParticipantInfo;
  token: string;
  isHost: boolean;
  preset: QualityPreset;
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
  const [myUpload, setMyUpload] = useState<UploadHealth | null>(null);
  const [connected, setConnected] = useState(false);
  const [replaced, setReplaced] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signalingRef = useRef<Signaling | null>(null);
  const peerManagerRef = useRef<PeerManager | null>(null);
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

    const signaling = new Signaling(config.token, {
      onWelcome: (_self, existingPeers, activeRecording) => {
        const pm = new PeerManager(signaling, config.participant.id, (pid, media) => {
          updatePeer(pid, { media });
        });
        peerManagerRef.current = pm;
        pm.setCameraStream(config.cameraStream);
        if (screenStreamRef.current) pm.setScreenStream(screenStreamRef.current);

        setPeers(() => {
          const map = new Map<string, RoomPeer>();
          for (const peer of existingPeers) {
            map.set(peer.participantId, { ...peer, media: { camera: null, screen: null } });
            pm.addPeer(peer.participantId); // we're the newcomer: we initiate offers
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
        beginLocalRecording(recordingId, startedAtMs);
      },
      onRecordingStopped: () => {
        engineRef.current?.stopAll();
        recordingRef.current = null;
        setRecording(null);
      },
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
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current = null;
    setScreenStream(null);
    peerManagerRef.current?.setScreenStream(null);
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
    startRecording,
    stopRecording,
    myUpload,
    connected,
    replaced,
    error,
    dismissError: () => setError(null),
  };
}
