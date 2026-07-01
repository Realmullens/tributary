import { pickMimeType } from "./recorder/recorder";

export type ProgramSource = {
  name: string;
  stream: MediaStream;
  kind: "camera" | "screen";
};

/**
 * "Program out": composites every participant onto a canvas, mixes all audio,
 * and pushes the result as a WebM stream over WS. The server (ffmpeg) fans it
 * out to HLS for the public watch page and optionally an RTMP destination.
 */
export class ProgramStreamer {
  private canvas = document.createElement("canvas");
  private ctx = this.canvas.getContext("2d")!;
  private audioCtx = new AudioContext({ sampleRate: 48000 });
  private audioDest = this.audioCtx.createMediaStreamDestination();
  private audioSources = new Map<MediaStream, MediaStreamAudioSourceNode>();
  private videoEls = new Map<MediaStream, HTMLVideoElement>();
  private recorder: MediaRecorder | null = null;
  private ws: WebSocket | null = null;
  private raf = 0;
  private stopped = false;
  private getSources: () => ProgramSource[];
  onStatus: ((live: boolean, error?: string) => void) | null = null;

  constructor(getSources: () => ProgramSource[], width = 1280, height = 720) {
    this.canvas.width = width;
    this.canvas.height = height;
    this.getSources = getSources;
  }

  async start(participantToken: string, rtmpUrl: string | null): Promise<void> {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const params = new URLSearchParams({ token: participantToken });
    if (rtmpUrl) params.set("rtmp", rtmpUrl);
    const ws = new WebSocket(`${proto}://${location.host}/stream-ingest?${params}`);
    ws.binaryType = "arraybuffer";
    this.ws = ws;

    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("stream ingest connection failed"));
      ws.onclose = (e) => reject(new Error(e.reason || "stream ingest closed"));
    });
    ws.onclose = () => {
      if (!this.stopped) this.onStatus?.(false, "stream connection lost");
      this.stop();
    };
    ws.onerror = null;

    if (this.audioCtx.state === "suspended") await this.audioCtx.resume();
    this.drawLoop();

    const mixed = new MediaStream([
      ...this.canvas.captureStream(30).getVideoTracks(),
      ...this.audioDest.stream.getAudioTracks(),
    ]);
    const mime = pickMimeType(true);
    if (!mime || !mime.includes("webm")) {
      throw new Error("Live streaming needs WebM MediaRecorder support (Chrome/Edge/Firefox)");
    }
    const recorder = new MediaRecorder(mixed, {
      mimeType: mime,
      videoBitsPerSecond: 4_000_000,
      audioBitsPerSecond: 128_000,
    });
    this.recorder = recorder;
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) {
        void e.data.arrayBuffer().then((buf) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(buf);
        });
      }
    };
    recorder.start(1000);
    this.onStatus?.(true);
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    cancelAnimationFrame(this.raf);
    if (this.recorder?.state === "recording") this.recorder.stop();
    this.ws?.close();
    for (const el of this.videoEls.values()) {
      el.srcObject = null;
    }
    void this.audioCtx.close();
    this.onStatus?.(false);
  }

  /** Keep hidden <video> elements + audio graph in sync with current sources. */
  private syncSources(sources: ProgramSource[]): void {
    const liveStreams = new Set(sources.map((s) => s.stream));
    for (const [stream, el] of this.videoEls) {
      if (!liveStreams.has(stream)) {
        el.srcObject = null;
        this.videoEls.delete(stream);
      }
    }
    for (const [stream, node] of this.audioSources) {
      if (!liveStreams.has(stream)) {
        node.disconnect();
        this.audioSources.delete(stream);
      }
    }
    for (const source of sources) {
      if (!this.videoEls.has(source.stream) && source.stream.getVideoTracks().length > 0) {
        const el = document.createElement("video");
        el.muted = true;
        el.playsInline = true;
        el.srcObject = source.stream;
        void el.play().catch(() => {});
        this.videoEls.set(source.stream, el);
      }
      if (!this.audioSources.has(source.stream) && source.stream.getAudioTracks().length > 0) {
        const node = this.audioCtx.createMediaStreamSource(source.stream);
        node.connect(this.audioDest);
        this.audioSources.set(source.stream, node);
      }
    }
  }

  private drawLoop = (): void => {
    if (this.stopped) return;
    const sources = this.getSources();
    this.syncSources(sources);

    const { width: W, height: H } = this.canvas;
    this.ctx.fillStyle = "#111318";
    this.ctx.fillRect(0, 0, W, H);

    const videoSources = sources.filter((s) => this.videoEls.has(s.stream));
    const n = videoSources.length;
    if (n > 0) {
      const cols = Math.ceil(Math.sqrt(n));
      const rows = Math.ceil(n / cols);
      const cellW = W / cols;
      const cellH = H / rows;
      videoSources.forEach((source, i) => {
        const el = this.videoEls.get(source.stream)!;
        if (el.videoWidth === 0) return;
        const col = i % cols;
        const row = Math.floor(i / cols);
        const scale = Math.min(cellW / el.videoWidth, cellH / el.videoHeight);
        const dw = el.videoWidth * scale;
        const dh = el.videoHeight * scale;
        const dx = col * cellW + (cellW - dw) / 2;
        const dy = row * cellH + (cellH - dh) / 2;
        this.ctx.drawImage(el, dx, dy, dw, dh);
        this.ctx.fillStyle = "rgba(0,0,0,0.55)";
        this.ctx.fillRect(dx + 8, dy + dh - 30, this.ctx.measureText(source.name).width + 46, 22);
        this.ctx.fillStyle = "#fff";
        this.ctx.font = "14px system-ui, sans-serif";
        this.ctx.fillText(source.name, dx + 14, dy + dh - 14);
      });
    }
    this.raf = requestAnimationFrame(this.drawLoop);
  };
}
