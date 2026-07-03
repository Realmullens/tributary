import type { CSSProperties, ReactNode } from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export const colors = {
  ink: "#0e0c13",
  ink2: "#131019",
  panel: "#16131d",
  edge: "#2c2638",
  accent: "#7c5cff",
  accent2: "#a78bfa",
  rec: "#fb3b4e",
  text: "#ece9f4",
  dim: "#9b93ad",
};

export const font =
  'ui-sans-serif, -apple-system, "SF Pro Display", "Segoe UI", sans-serif';

/** Animated dark backdrop with drifting brand-colored glows. */
export function Bg({ children }: { children?: ReactNode }) {
  const frame = useCurrentFrame();
  const drift = Math.sin(frame / 90) * 60;
  const drift2 = Math.cos(frame / 110) * 80;
  return (
    <AbsoluteFill style={{ backgroundColor: colors.ink, fontFamily: font }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(600px 500px at ${20 + drift / 10}% ${30 + drift2 / 12}%, rgba(124,92,255,0.16), transparent 70%),
             radial-gradient(700px 600px at ${80 - drift2 / 10}% ${75 + drift / 14}%, rgba(45,212,191,0.07), transparent 70%)`,
        }}
      />
      {children}
    </AbsoluteFill>
  );
}

export function GradientText({
  children,
  style,
}: {
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <span
      style={{
        background: `linear-gradient(90deg, ${colors.accent2}, ${colors.accent})`,
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
        color: "transparent",
        ...style,
      }}
    >
      {children}
    </span>
  );
}

/** Spring pop-in wrapper. */
export function Pop({
  at,
  children,
  from = 0.8,
}: {
  at: number;
  children: ReactNode;
  from?: number;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - at, fps, config: { damping: 14, mass: 0.7 } });
  return (
    <div
      style={{
        transform: `scale(${from + (1 - from) * s})`,
        opacity: Math.min(1, s * 1.4),
      }}
    >
      {children}
    </div>
  );
}

/** Feature callout chip, Riverside-pill styled. */
export function Chip({
  at,
  children,
  tone = "accent",
}: {
  at: number;
  children: ReactNode;
  tone?: "accent" | "rec" | "dark";
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - at, fps, config: { damping: 13, mass: 0.6 } });
  const bg =
    tone === "accent"
      ? `linear-gradient(90deg, ${colors.accent}, #6847e8)`
      : tone === "rec"
        ? `linear-gradient(90deg, ${colors.rec}, #d92438)`
        : "rgba(22,19,29,0.92)";
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 14,
        padding: "16px 32px",
        borderRadius: 999,
        background: bg,
        border: tone === "dark" ? `1.5px solid ${colors.edge}` : "none",
        color: "white",
        fontSize: 30,
        fontWeight: 650,
        fontFamily: font,
        letterSpacing: -0.3,
        boxShadow: "0 14px 40px rgba(0,0,0,0.4)",
        transform: `translateY(${(1 - s) * 40}px) scale(${0.9 + 0.1 * s})`,
        opacity: Math.min(1, s * 1.5),
      }}
    >
      {children}
    </div>
  );
}

/** Rounded browser-ish frame for screenshots/footage. */
export function Screen({
  children,
  at = 0,
  tilt = 0,
}: {
  children: ReactNode;
  at?: number;
  tilt?: number;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - at, fps, config: { damping: 16, mass: 0.9 } });
  return (
    <div
      style={{
        borderRadius: 22,
        overflow: "hidden",
        border: `1.5px solid ${colors.edge}`,
        boxShadow: "0 40px 120px rgba(0,0,0,0.6), 0 0 90px rgba(124,92,255,0.12)",
        transform: `scale(${0.94 + 0.06 * s}) rotate(${tilt}deg)`,
        opacity: Math.min(1, s * 1.6),
        lineHeight: 0,
      }}
    >
      {children}
    </div>
  );
}

/** Full-screen centered text beat with fade-in/out. */
export function Beat({
  children,
  inAt,
  outAt,
  size = 84,
}: {
  children: ReactNode;
  inAt: number;
  outAt: number;
  size?: number;
}) {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [inAt, inAt + 12, outAt - 10, outAt], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const y = interpolate(frame, [inAt, inAt + 14], [26, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const blur = interpolate(frame, [outAt - 10, outAt], [0, 8], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        justifyContent: "center",
        opacity,
        transform: `translateY(${y}px)`,
        filter: blur > 0.1 ? `blur(${blur}px)` : undefined,
      }}
    >
      <div
        style={{
          fontFamily: font,
          fontSize: size,
          fontWeight: 760,
          letterSpacing: -2.5,
          color: colors.text,
          textAlign: "center",
          maxWidth: 1500,
          lineHeight: 1.12,
        }}
      >
        {children}
      </div>
    </AbsoluteFill>
  );
}
