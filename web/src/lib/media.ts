import type { QualityPreset } from "./recorder/recorder";

export type DeviceInfo = { deviceId: string; label: string };

export async function listDevices(): Promise<{
  cameras: DeviceInfo[];
  microphones: DeviceInfo[];
  speakers: DeviceInfo[];
}> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const pick = (kind: MediaDeviceKind, fallback: string) =>
    devices
      .filter((d) => d.kind === kind)
      .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `${fallback} ${i + 1}` }));
  return {
    cameras: pick("videoinput", "Camera"),
    microphones: pick("audioinput", "Microphone"),
    speakers: pick("audiooutput", "Speaker"),
  };
}

export type CaptureSettings = {
  cameraId: string | null;
  microphoneId: string | null;
  preset: QualityPreset;
  echoCancellation: boolean; // "are you wearing headphones?" → off
};

export function buildConstraints(settings: CaptureSettings): MediaStreamConstraints {
  const video: MediaTrackConstraints | boolean =
    settings.preset === "audio"
      ? false
      : {
          ...(settings.cameraId ? { deviceId: { exact: settings.cameraId } } : {}),
          width: { ideal: settings.preset === "high" ? 1920 : 1280 },
          height: { ideal: settings.preset === "high" ? 1080 : 720 },
          frameRate: { ideal: 30 },
        };
  const audio: MediaTrackConstraints = {
    ...(settings.microphoneId ? { deviceId: { exact: settings.microphoneId } } : {}),
    echoCancellation: settings.echoCancellation,
    noiseSuppression: settings.echoCancellation,
    autoGainControl: true,
    sampleRate: 48000,
    channelCount: 2,
  };
  return { video, audio };
}

/** Poll mic level (0..1) from a stream. Returns a cleanup function. */
export function watchMicLevel(stream: MediaStream, onLevel: (level: number) => void): () => void {
  const audioTracks = stream.getAudioTracks();
  if (audioTracks.length === 0) return () => {};
  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  const data = new Uint8Array(analyser.frequencyBinCount);
  let raf = 0;
  const tick = () => {
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (const v of data) {
      const centered = (v - 128) / 128;
      sum += centered * centered;
    }
    onLevel(Math.min(1, Math.sqrt(sum / data.length) * 3));
    raf = requestAnimationFrame(tick);
  };
  tick();
  return () => {
    cancelAnimationFrame(raf);
    source.disconnect();
    void ctx.close();
  };
}
