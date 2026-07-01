import {
  Room,
  RoomEvent,
  Track,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
} from "livekit-client";
import { api } from "../api";
import type { RemoteMedia } from "./peers";

/**
 * SFU media transport. Presence, chat, recording control, and upload health
 * stay on Tributary's own WebSocket — LiveKit only carries the audio/video.
 * Participant identity == our participantId, so peer lists line up.
 */
export class LiveKitManager {
  private room: Room;
  private participantToken: string;
  private url: string;
  private cameraStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;
  private media = new Map<string, RemoteMedia>();
  private onMediaChange: (participantId: string, media: RemoteMedia) => void;

  constructor(
    url: string,
    participantToken: string,
    onMediaChange: (participantId: string, media: RemoteMedia) => void
  ) {
    this.url = url;
    this.participantToken = participantToken;
    this.onMediaChange = onMediaChange;
    this.room = new Room({ adaptiveStream: true, dynacast: true });

    this.room.on(RoomEvent.TrackSubscribed, (track, pub, participant) =>
      this.handleTrack(track, pub, participant)
    );
    this.room.on(RoomEvent.TrackUnsubscribed, (_track, pub, participant) => {
      this.removeTrack(participant.identity, pub.source);
    });
    this.room.on(RoomEvent.ParticipantDisconnected, (participant) => {
      this.media.delete(participant.identity);
      this.onMediaChange(participant.identity, { camera: null, screen: null });
    });
  }

  async connect(): Promise<void> {
    const { token } = await api<{ token: string }>("/api/livekit-token", {
      token: this.participantToken,
      body: {},
    });
    await this.room.connect(this.url, token);
    await this.publishStreams();
  }

  private async publishStreams(): Promise<void> {
    if (this.cameraStream) {
      for (const track of this.cameraStream.getVideoTracks()) {
        await this.room.localParticipant.publishTrack(track, { source: Track.Source.Camera });
      }
      for (const track of this.cameraStream.getAudioTracks()) {
        await this.room.localParticipant.publishTrack(track, { source: Track.Source.Microphone });
      }
    }
    if (this.screenStream) {
      for (const track of this.screenStream.getVideoTracks()) {
        await this.room.localParticipant.publishTrack(track, { source: Track.Source.ScreenShare });
      }
      for (const track of this.screenStream.getAudioTracks()) {
        await this.room.localParticipant.publishTrack(track, {
          source: Track.Source.ScreenShareAudio,
        });
      }
    }
  }

  private mediaFor(participantId: string): RemoteMedia {
    let m = this.media.get(participantId);
    if (!m) {
      m = { camera: null, screen: null };
      this.media.set(participantId, m);
    }
    return m;
  }

  private handleTrack(
    track: RemoteTrack,
    pub: RemoteTrackPublication,
    participant: RemoteParticipant
  ): void {
    const media = this.mediaFor(participant.identity);
    const isScreen =
      pub.source === Track.Source.ScreenShare || pub.source === Track.Source.ScreenShareAudio;
    const kind = isScreen ? "screen" : "camera";
    const stream = media[kind] ?? new MediaStream();
    stream.addTrack(track.mediaStreamTrack);
    const next = { ...media, [kind]: stream };
    this.media.set(participant.identity, next);
    this.onMediaChange(participant.identity, next);
  }

  private removeTrack(participantId: string, source: Track.Source): void {
    const media = this.mediaFor(participantId);
    const kind =
      source === Track.Source.ScreenShare || source === Track.Source.ScreenShareAudio
        ? "screen"
        : "camera";
    // Rebuild the stream without the unpublished track kind; simplest is to
    // clear the slot when its video disappears (audio-only remnant is fine).
    if (kind === "screen" && source === Track.Source.ScreenShare) {
      const next = { ...media, screen: null };
      this.media.set(participantId, next);
      this.onMediaChange(participantId, next);
    }
  }

  setCameraStream(stream: MediaStream | null): void {
    this.cameraStream = stream;
    if (this.room.state === "connected") void this.publishStreams();
  }

  async setScreenStream(stream: MediaStream | null): Promise<void> {
    if (!stream && this.screenStream) {
      for (const track of this.screenStream.getTracks()) {
        const pub = this.room.localParticipant.getTrackPublicationByName?.(track.id);
        void pub;
        await this.room.localParticipant.unpublishTrack(track).catch(() => {});
      }
    }
    this.screenStream = stream;
    if (stream && this.room.state === "connected") {
      for (const track of stream.getVideoTracks()) {
        await this.room.localParticipant.publishTrack(track, { source: Track.Source.ScreenShare });
      }
      for (const track of stream.getAudioTracks()) {
        await this.room.localParticipant.publishTrack(track, {
          source: Track.Source.ScreenShareAudio,
        });
      }
    }
  }

  close(): void {
    void this.room.disconnect();
  }
}
