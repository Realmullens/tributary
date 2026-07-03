import { AbsoluteFill, Img, staticFile } from "remotion";
import { GradientText, colors, font } from "./theme";

function CardBg({ children }: { children: React.ReactNode }) {
  return (
    <AbsoluteFill
      style={{
        backgroundColor: colors.ink,
        fontFamily: font,
        background: `radial-gradient(900px 700px at 12% 0%, rgba(124,92,255,0.20), transparent 65%),
           radial-gradient(800px 700px at 95% 100%, rgba(45,212,191,0.08), transparent 65%),
           ${colors.ink}`,
      }}
    >
      {children}
    </AbsoluteFill>
  );
}

function Wordmark({ size = 34 }: { size?: number }) {
  return (
    <div style={{ fontSize: size, fontWeight: 780, letterSpacing: -1 }}>
      <GradientText>Tributary</GradientText>
    </div>
  );
}

/** Feature card: headline + sub + screenshot bleeding off the bottom-right. */
export function FeatureCard({
  headline,
  sub,
  image,
  pill,
}: {
  headline: React.ReactNode;
  sub: string;
  image: string;
  pill: string;
}) {
  return (
    <CardBg>
      <div style={{ position: "absolute", top: 54, left: 64 }}>
        <Wordmark />
      </div>
      <div
        style={{
          position: "absolute",
          top: 52,
          right: 64,
          fontSize: 22,
          fontWeight: 650,
          color: "white",
          background: `linear-gradient(90deg, ${colors.accent}, #6847e8)`,
          padding: "10px 22px",
          borderRadius: 999,
        }}
      >
        {pill}
      </div>
      <div style={{ position: "absolute", top: 150, left: 64, width: 700 }}>
        <div
          style={{
            fontSize: 64,
            fontWeight: 780,
            letterSpacing: -2.2,
            color: colors.text,
            lineHeight: 1.1,
          }}
        >
          {headline}
        </div>
        <div style={{ fontSize: 27, color: colors.dim, marginTop: 22, lineHeight: 1.45, fontWeight: 480 }}>
          {sub}
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: 64,
          bottom: 46,
          fontSize: 22,
          color: colors.dim,
          fontWeight: 560,
        }}
      >
        github.com/Realmullens/tributary · MIT
      </div>
      <div
        style={{
          position: "absolute",
          right: -160,
          bottom: -110,
          borderRadius: 18,
          overflow: "hidden",
          border: `1.5px solid ${colors.edge}`,
          boxShadow: "0 40px 120px rgba(0,0,0,0.65), 0 0 90px rgba(124,92,255,0.14)",
          transform: "rotate(-4deg)",
          lineHeight: 0,
        }}
      >
        <Img src={staticFile(image)} style={{ width: 1000 }} />
      </div>
    </CardBg>
  );
}

/** Wide hero/banner: centered wordmark + tagline (GitHub social preview). */
export function Banner() {
  return (
    <CardBg>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 24 }}>
        <div style={{ fontSize: 120, fontWeight: 800, letterSpacing: -5 }}>
          <GradientText>Tributary</GradientText>
        </div>
        <div style={{ fontSize: 36, color: colors.text, fontWeight: 620, letterSpacing: -0.8 }}>
          The open-source remote recording studio
        </div>
        <div style={{ fontSize: 25, color: colors.dim, fontWeight: 500 }}>
          Local per-guest recording · crash-proof uploads · separate tracks · text-based editing
        </div>
      </AbsoluteFill>
      <div
        style={{
          position: "absolute",
          bottom: 34,
          width: "100%",
          textAlign: "center",
          fontSize: 22,
          color: colors.dim,
          fontWeight: 560,
        }}
      >
        MIT licensed · github.com/Realmullens/tributary
      </div>
    </CardBg>
  );
}

/** Hero card with the studio screenshot front and center. */
export function HeroCard() {
  return (
    <CardBg>
      <AbsoluteFill style={{ alignItems: "center" }}>
        <div style={{ marginTop: 66, textAlign: "center" }}>
          <div style={{ fontSize: 66, fontWeight: 790, letterSpacing: -2.4, color: colors.text }}>
            Your own <GradientText>Riverside</GradientText>. Self-hosted.
          </div>
          <div style={{ fontSize: 28, color: colors.dim, marginTop: 14, fontWeight: 500 }}>
            Every guest recorded locally in full quality — no matter how bad the call is.
          </div>
        </div>
        <div
          style={{
            marginTop: 44,
            borderRadius: 18,
            overflow: "hidden",
            border: `1.5px solid ${colors.edge}`,
            boxShadow: "0 40px 120px rgba(0,0,0,0.65), 0 0 110px rgba(124,92,255,0.16)",
            lineHeight: 0,
          }}
        >
          <Img src={staticFile("studio.png")} style={{ width: 1240 }} />
        </div>
      </AbsoluteFill>
      <div
        style={{
          position: "absolute",
          bottom: 30,
          width: "100%",
          textAlign: "center",
          fontSize: 22,
          color: colors.dim,
          fontWeight: 560,
        }}
      >
        MIT licensed · github.com/Realmullens/tributary
      </div>
    </CardBg>
  );
}
