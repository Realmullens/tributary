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

// ---------- Timeline ----------
const S = {
  hook: { from: 0, dur: 135 },
  setup: { from: 135, dur: 160 },
  record: { from: 295, dur: 270 },
  resilience: { from: 565, dur: 210 },
  tracks: { from: 775, dur: 195 },
  editor: { from: 970, dur: 225 },
  rapid: { from: 1195, dur: 150 },
  terminal: { from: 1345, dur: 165 },
  cta: { from: 1510, dur: 200 },
};

/** Scene wrapper: gentle fade through the backdrop at both ends. */
function Fade({ children }: { children: React.ReactNode }) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const opacity = interpolate(
    frame,
    [0, 9, durationInFrames - 9, durationInFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
}

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
function KenBurns({ src, zoom = 0.07 }: { src: string; zoom?: number }) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const s = 1 + (frame / durationInFrames) * zoom;
  return (
    <div style={{ overflow: "hidden", lineHeight: 0 }}>
      <Img src={staticFile(src)} style={{ width: 1600, transform: `scale(${s})` }} />
    </div>
  );
}

/** Living screen: pop-in, then a barely-perceptible continuous drift. */
function Drift({ children }: { children: React.ReactNode }) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const z = 1 + (frame / durationInFrames) * 0.02;
  const y = Math.sin(frame / 55) * 3;
  return <div style={{ transform: `scale(${z}) translateY(${y}px)` }}>{children}</div>;
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
      <Drift>{children}</Drift>
      {/* scrim so the callouts read cleanly over footage */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: 240,
          background: `linear-gradient(to top, ${colors.ink} 12%, rgba(14,12,19,0.55) 55%, transparent)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: 64,
          display: "flex",
          gap: 16,
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
  const s = spring({ frame: frame - 8, fps, config: { damping: 13, mass: 0.9 } });
  const glow = interpolate(frame, [8, 55], [0, 0.55], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const words = ["Own", "your", "recording", "studio."];
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div
        style={{
          position: "absolute",
          width: 1250,
          height: 620,
          borderRadius: "50%",
          background: `radial-gradient(ellipse, rgba(124,92,255,0.22), transparent 65%)`,
          opacity: glow,
        }}
      />
      <div
        style={{
          fontFamily: font,
          fontSize: 176,
          fontWeight: 800,
          letterSpacing: -7 + (1 - s) * 10,
          transform: `scale(${0.82 + 0.18 * s})`,
          opacity: Math.min(1, s * 1.5),
        }}
      >
        <GradientText>Tributary</GradientText>
      </div>
      <div style={{ display: "flex", gap: 15, marginTop: 22 }}>
        {words.map((w, i) => {
          const o = interpolate(frame, [48 + i * 7, 62 + i * 7], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
          return (
            <span
              key={w}
              style={{
                fontFamily: font,
                fontSize: 44,
                fontWeight: 560,
                color: colors.dim,
                letterSpacing: -0.8,
                opacity: o,
                transform: `translateY(${(1 - o) * 10}px)`,
                display: "inline-block",
              }}
            >
              {w}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}

function Setup() {
  return (
    <>
      <Beat inAt={0} outAt={74} size={90}>
        Remote interviews deserve better than{" "}
        <span style={{ color: colors.rec }}>&ldquo;can you hear me?&rdquo;</span>
      </Beat>
      <Beat inAt={80} outAt={158} size={90}>
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
        { at: 165, text: "💬  Chat, teleprompter, host controls", tone: "dark" },
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
          <Clip fromSec={22.0} />
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
        { at: 92, text: "MP4 + 48 kHz WAV + mixed exports", tone: "dark" },
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
        { at: 140, text: "Whisper transcription, speaker-labeled", tone: "dark" },
      ]}
    >
      <Screen>
        <Clip fromSec={117.5} />
      </Screen>
    </SceneShell>
  );
}

function RapidScene() {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const z = 1 + (frame / durationInFrames) * 0.05;
  const items = [
    "📡  Live-stream to RTMP + public watch page",
    "📱  Social clips — 16:9 · 1:1 · 9:16, captions burned in",
    "🎬  Premiere / Final Cut XML export",
    "🤖  AI-agent CLI — post-production as JSON commands",
  ];
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <AbsoluteFill style={{ opacity: 0.22, alignItems: "center", justifyContent: "center" }}>
        <Img
          src={staticFile("still-dashboard.png")}
          style={{ width: 1920, filter: "blur(7px)", transform: `scale(${z})` }}
        />
      </AbsoluteFill>
      <div style={{ display: "flex", flexDirection: "column", gap: 24, alignItems: "center" }}>
        {items.map((text, i) => (
          <Chip key={text} at={10 + i * 30} tone={i % 2 ? "dark" : "accent"}>
            {text}
          </Chip>
        ))}
      </div>
    </AbsoluteFill>
  );
}

/** Typewriter terminal: zero to studio in two commands. */
function TerminalScene() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - 4, fps, config: { damping: 15, mass: 0.8 } });

  const typed = (text: string, start: number, cps = 1.1) => {
    const chars = Math.max(0, Math.floor((frame - start) / cps));
    return text.slice(0, chars);
  };
  const line1 = typed("pnpm install", 24);
  const line2 = frame > 62 ? typed("pnpm dev", 66) : "";
  const ready = frame > 96;
  const cursorOn = Math.floor(frame / 16) % 2 === 0;

  const headOpacity = interpolate(frame, [0, 14], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 44 }}>
      <div
        style={{
          fontFamily: font,
          fontSize: 66,
          fontWeight: 760,
          letterSpacing: -2,
          color: colors.text,
          opacity: headOpacity,
        }}
      >
        Zero to studio in <GradientText>two commands</GradientText>.
      </div>
      <div
        style={{
          width: 980,
          borderRadius: 18,
          overflow: "hidden",
          border: `1.5px solid ${colors.edge}`,
          background: "#12101a",
          boxShadow: "0 40px 110px rgba(0,0,0,0.55)",
          transform: `scale(${0.92 + 0.08 * s})`,
          opacity: Math.min(1, s * 1.5),
        }}
      >
        <div
          style={{
            display: "flex",
            gap: 9,
            padding: "16px 18px",
            borderBottom: `1px solid ${colors.edge}`,
          }}
        >
          {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
            <span key={c} style={{ width: 14, height: 14, borderRadius: 7, background: c }} />
          ))}
        </div>
        <div
          style={{
            fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
            fontSize: 30,
            lineHeight: 1.85,
            padding: "26px 34px 34px",
            color: "#d8d2ea",
          }}
        >
          <div>
            <span style={{ color: colors.accent2 }}>$</span> {line1}
            {!line2 && cursorOn && <span style={{ color: colors.accent2 }}>▍</span>}
          </div>
          {line2 && (
            <div>
              <span style={{ color: colors.accent2 }}>$</span> {line2}
              {!ready && cursorOn && <span style={{ color: colors.accent2 }}>▍</span>}
            </div>
          )}
          {ready && (
            <div style={{ color: "#3ddc97" }}>
              ✓ studio running — http://localhost:4110
            </div>
          )}
        </div>
      </div>
    </AbsoluteFill>
  );
}

function Cta() {
  const frame = useCurrentFrame();
  const pulse = 1 + Math.sin(frame / 10) * 0.012;
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 32 }}>
      <Pop at={4}>
        <div style={{ fontFamily: font, fontSize: 58, fontWeight: 780, letterSpacing: -2 }}>
          <GradientText>Tributary</GradientText>
        </div>
      </Pop>
      <Pop at={12}>
        <div
          style={{
            fontFamily: font,
            fontSize: 96,
            fontWeight: 790,
            letterSpacing: -3.2,
            color: colors.text,
            textAlign: "center",
            lineHeight: 1.08,
          }}
        >
          MIT licensed. Self-host it tonight.
        </div>
      </Pop>
      <Pop at={30}>
        <div
          style={{
            fontFamily: font,
            fontSize: 38,
            fontWeight: 640,
            color: "white",
            background: `linear-gradient(90deg, ${colors.accent}, #6847e8)`,
            padding: "19px 42px",
            borderRadius: 999,
            transform: `scale(${pulse})`,
            boxShadow: "0 20px 70px rgba(124,92,255,0.35)",
          }}
        >
          github.com/Realmullens/tributary
        </div>
      </Pop>
      <Pop at={44}>
        <div style={{ fontFamily: font, fontSize: 29, color: colors.dim, fontWeight: 550 }}>
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
        Music: “Born Of The Sky” — Scott Buckley (scottbuckley.com.au) · CC BY 4.0
      </div>
    </AbsoluteFill>
  );
}

// ---------- Sound design (conservative) ----------

function Sfx() {
  return (
    <>
      {/* logo landing */}
      <Sequence from={6} durationInFrames={32}>
        <Audio src={staticFile("sfx-thud-soft.wav")} volume={0.5} />
      </Sequence>
      {/* two whooshes only: into the product, and into the rapid-fire montage */}
      {[S.record.from, S.rapid.from].map((f) => (
        <Sequence key={f} from={f - 6} durationInFrames={32}>
          <Audio src={staticFile("sfx-whoosh-soft.wav")} volume={0.28} />
        </Sequence>
      ))}
      {/* gentle riser + chime into the CTA */}
      <Sequence from={S.cta.from - 70} durationInFrames={75}>
        <Audio src={staticFile("sfx-riser-soft.wav")} volume={0.3} />
      </Sequence>
      <Sequence from={S.cta.from + 6} durationInFrames={56}>
        <Audio src={staticFile("sfx-chime-soft.wav")} volume={0.35} />
      </Sequence>
    </>
  );
}

export function Promo() {
  return (
    <Bg>
      {/* vignette */}
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 58%, rgba(0,0,0,0.42) 100%)",
          zIndex: 5,
          pointerEvents: "none",
        }}
      />
      <Audio
        src={staticFile("BornOfTheSky.mp3")}
        startFrom={48 * FPS}
        volume={(f) =>
          interpolate(f, [0, 30, PROMO_DURATION - 80, PROMO_DURATION - 8], [0, 0.55, 0.55, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          })
        }
      />
      <Sfx />
      <Sequence from={S.hook.from} durationInFrames={S.hook.dur}>
        <Fade>
          <Hook />
        </Fade>
      </Sequence>
      <Sequence from={S.setup.from} durationInFrames={S.setup.dur}>
        <Setup />
      </Sequence>
      <Sequence from={S.record.from} durationInFrames={S.record.dur}>
        <Fade>
          <RecordScene />
        </Fade>
      </Sequence>
      <Sequence from={S.resilience.from} durationInFrames={S.resilience.dur}>
        <Fade>
          <ResilienceScene />
        </Fade>
      </Sequence>
      <Sequence from={S.tracks.from} durationInFrames={S.tracks.dur}>
        <Fade>
          <TracksScene />
        </Fade>
      </Sequence>
      <Sequence from={S.editor.from} durationInFrames={S.editor.dur}>
        <Fade>
          <EditorScene />
        </Fade>
      </Sequence>
      <Sequence from={S.rapid.from} durationInFrames={S.rapid.dur}>
        <Fade>
          <RapidScene />
        </Fade>
      </Sequence>
      <Sequence from={S.terminal.from} durationInFrames={S.terminal.dur}>
        <Fade>
          <TerminalScene />
        </Fade>
      </Sequence>
      <Sequence from={S.cta.from} durationInFrames={S.cta.dur}>
        <Fade>
          <Cta />
        </Fade>
      </Sequence>
    </Bg>
  );
}
