import {
  AbsoluteFill,
  Audio,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Beat, Bg, Chip, GradientText, Pop, Screen, colors, font } from "./theme";

const FPS = 30;
export const PROMO_DURATION = 57 * FPS; // 1710

/** Footage clip trimmed from the captured host flow (seconds → frames). */
function Clip({ fromSec, scale = 1 }: { fromSec: number; scale?: number }) {
  return (
    <OffthreadVideo
      muted
      src={staticFile("host-flow.mp4")}
      startFrom={Math.round(fromSec * FPS)}
      style={{ width: 1600 * scale, display: "block" }}
    />
  );
}

/** Slow Ken Burns zoom on a still. */
function KenBurns({ src, zoom = 0.08 }: { src: string; zoom?: number }) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const s = 1 + (frame / durationInFrames) * zoom;
  return (
    <div style={{ overflow: "hidden", lineHeight: 0 }}>
      <Img src={staticFile(src)} style={{ width: 1600, transform: `scale(${s})` }} />
    </div>
  );
}

function SceneShell({
  chips,
  children,
}: {
  chips: { at: number; text: string; tone?: "accent" | "rec" | "dark" }[];
  children: React.ReactNode;
}) {
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      {children}
      <div
        style={{
          position: "absolute",
          bottom: 70,
          display: "flex",
          gap: 18,
          alignItems: "center",
        }}
      >
        {chips.map((c) => (
          <Chip key={c.text} at={c.at} tone={c.tone}>
            {c.text}
          </Chip>
        ))}
      </div>
    </AbsoluteFill>
  );
}

// ---------- Scenes ----------

function Hook() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - 8, fps, config: { damping: 12, mass: 0.8 } });
  const tagOpacity = interpolate(frame, [45, 62], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div
        style={{
          fontFamily: font,
          fontSize: 180,
          fontWeight: 800,
          letterSpacing: -7,
          transform: `scale(${0.7 + 0.3 * s})`,
          opacity: Math.min(1, s * 1.4),
        }}
      >
        <GradientText>Tributary</GradientText>
      </div>
      <div
        style={{
          fontFamily: font,
          fontSize: 44,
          fontWeight: 560,
          color: colors.dim,
          marginTop: 18,
          letterSpacing: -0.8,
          opacity: tagOpacity,
        }}
      >
        Own your recording studio.
      </div>
    </AbsoluteFill>
  );
}

function Setup() {
  return (
    <>
      <Beat inAt={0} outAt={78} size={92}>
        Remote interviews deserve better than{" "}
        <span style={{ color: colors.rec }}>&ldquo;can you hear me?&rdquo;</span>
      </Beat>
      <Beat inAt={82} outAt={165} size={92}>
        Meet the <GradientText>open-source</GradientText> remote recording studio.
      </Beat>
    </>
  );
}

function RecordScene() {
  return (
    <SceneShell
      chips={[
        { at: 55, text: "🎥  Every guest recorded locally — up to 4K" },
        { at: 160, text: "💬  Chat, teleprompter, host controls", tone: "dark" },
      ]}
    >
      <Sequence from={0} durationInFrames={135} layout="none">
        <Screen>
          <Clip fromSec={3.0} />
        </Screen>
      </Sequence>
      <Sequence from={135} layout="none">
        <Screen>
          <Clip fromSec={10.5} />
        </Screen>
      </Sequence>
    </SceneShell>
  );
}

function ResilienceScene() {
  return (
    <SceneShell
      chips={[
        { at: 25, text: "📦  Every chunk saved on-device first", tone: "rec" },
        { at: 130, text: "☁️  …then uploaded in the background. Crash-proof.", tone: "dark" },
      ]}
    >
      <Sequence from={0} durationInFrames={105} layout="none">
        <Screen>
          <Clip fromSec={14.0} />
        </Screen>
      </Sequence>
      <Sequence from={105} layout="none">
        <Screen>
          <Clip fromSec={31.5} />
        </Screen>
      </Sequence>
    </SceneShell>
  );
}

function TracksScene() {
  return (
    <SceneShell
      chips={[
        { at: 20, text: "🎚  Separate synced tracks per guest" },
        { at: 95, text: "MP4 + 48 kHz WAV + mixed exports", tone: "dark" },
      ]}
    >
      <Screen>
        <KenBurns src="session.png" />
      </Screen>
    </SceneShell>
  );
}

function EditorScene() {
  return (
    <SceneShell
      chips={[
        { at: 30, text: "✂️  Edit by deleting words — the video follows" },
        { at: 150, text: "Whisper transcription, speaker-labeled", tone: "dark" },
      ]}
    >
      <Screen>
        <Clip fromSec={117.5} />
      </Screen>
    </SceneShell>
  );
}

function RapidScene() {
  const items = [
    "📡  Live-stream to RTMP + public watch page",
    "📱  Social clips — 16:9 · 1:1 · 9:16, captions burned in",
    "🎬  Premiere / Final Cut XML export",
    "🤖  AI-agent CLI — post-production as JSON commands",
  ];
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <AbsoluteFill style={{ opacity: 0.28, alignItems: "center", justifyContent: "center" }}>
        <Img src={staticFile("still-dashboard.png")} style={{ width: 1920, filter: "blur(6px)" }} />
      </AbsoluteFill>
      <div style={{ display: "flex", flexDirection: "column", gap: 26, alignItems: "center" }}>
        {items.map((text, i) => (
          <Chip key={text} at={12 + i * 42} tone={i % 2 ? "dark" : "accent"}>
            {text}
          </Chip>
        ))}
      </div>
    </AbsoluteFill>
  );
}

function Cta() {
  const frame = useCurrentFrame();
  const pulse = 1 + Math.sin(frame / 9) * 0.015;
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 34 }}>
      <Pop at={6}>
        <div
          style={{
            fontFamily: font,
            fontSize: 108,
            fontWeight: 790,
            letterSpacing: -3.5,
            color: colors.text,
            textAlign: "center",
            lineHeight: 1.08,
          }}
        >
          MIT licensed.
          <br />
          <GradientText>Self-host it tonight.</GradientText>
        </div>
      </Pop>
      <Pop at={26}>
        <div
          style={{
            fontFamily: font,
            fontSize: 40,
            fontWeight: 640,
            color: "white",
            background: `linear-gradient(90deg, ${colors.accent}, #6847e8)`,
            padding: "20px 44px",
            borderRadius: 999,
            transform: `scale(${pulse})`,
            boxShadow: "0 20px 70px rgba(124,92,255,0.35)",
          }}
        >
          github.com/Realmullens/tributary
        </div>
      </Pop>
      <Pop at={40}>
        <div style={{ fontFamily: font, fontSize: 30, color: colors.dim, fontWeight: 550 }}>
          ⭐ Star it · fork it · record something great
        </div>
      </Pop>
      <div
        style={{
          position: "absolute",
          bottom: 26,
          fontFamily: font,
          fontSize: 17,
          color: "#5d5570",
        }}
      >
        Music: “Voxel Revolution” — Kevin MacLeod (incompetech.com) · CC BY 4.0
      </div>
    </AbsoluteFill>
  );
}

// ---------- Timeline ----------

const S = {
  hook: { from: 0, dur: 135 },
  setup: { from: 135, dur: 165 },
  record: { from: 300, dur: 270 },
  resilience: { from: 570, dur: 210 },
  tracks: { from: 780, dur: 210 },
  editor: { from: 990, dur: 240 },
  rapid: { from: 1230, dur: 210 },
  cta: { from: 1440, dur: 270 },
};

function Sfx() {
  const whooshAt = [S.setup.from, S.record.from, S.resilience.from, S.tracks.from, S.editor.from, S.rapid.from];
  return (
    <>
      <Sequence from={6} durationInFrames={30}>
        <Audio src={staticFile("sfx-thud.wav")} volume={0.9} />
      </Sequence>
      {whooshAt.map((f) => (
        <Sequence key={f} from={f - 8} durationInFrames={32}>
          <Audio src={staticFile("sfx-whoosh.wav")} volume={0.5} />
        </Sequence>
      ))}
      {/* clicks for rapid-fire chips */}
      {[0, 1, 2, 3].map((i) => (
        <Sequence key={i} from={S.rapid.from + 12 + i * 42} durationInFrames={12}>
          <Audio src={staticFile("sfx-click.wav")} volume={0.55} />
        </Sequence>
      ))}
      <Sequence from={S.cta.from - 66} durationInFrames={70}>
        <Audio src={staticFile("sfx-riser.wav")} volume={0.55} />
      </Sequence>
      <Sequence from={S.cta.from + 4} durationInFrames={50}>
        <Audio src={staticFile("sfx-chime.wav")} volume={0.7} />
      </Sequence>
    </>
  );
}

export function Promo() {
  return (
    <Bg>
      <Audio
        src={staticFile("Voxel-Revolution.mp3")}
        volume={(f) =>
          interpolate(
            f,
            [0, 40, S.record.from, S.record.from + 30, PROMO_DURATION - 90, PROMO_DURATION - 12],
            [0, 0.16, 0.2, 0.34, 0.34, 0],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
          )
        }
      />
      <Sfx />
      <Sequence from={S.hook.from} durationInFrames={S.hook.dur}>
        <Hook />
      </Sequence>
      <Sequence from={S.setup.from} durationInFrames={S.setup.dur}>
        <Setup />
      </Sequence>
      <Sequence from={S.record.from} durationInFrames={S.record.dur}>
        <RecordScene />
      </Sequence>
      <Sequence from={S.resilience.from} durationInFrames={S.resilience.dur}>
        <ResilienceScene />
      </Sequence>
      <Sequence from={S.tracks.from} durationInFrames={S.tracks.dur}>
        <TracksScene />
      </Sequence>
      <Sequence from={S.editor.from} durationInFrames={S.editor.dur}>
        <EditorScene />
      </Sequence>
      <Sequence from={S.rapid.from} durationInFrames={S.rapid.dur}>
        <RapidScene />
      </Sequence>
      <Sequence from={S.cta.from} durationInFrames={S.cta.dur}>
        <Cta />
      </Sequence>
    </Bg>
  );
}
