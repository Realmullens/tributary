import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" | "rec" }) {
  const styles: Record<string, string> = {
    primary: "bg-accent hover:bg-accent/85 text-white",
    ghost: "bg-panel-2 hover:bg-edge text-gray-200 border border-edge",
    danger: "bg-rec/90 hover:bg-rec text-white",
    rec: "bg-rec hover:bg-rec/85 text-white",
  };
  return (
    <button
      className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${styles[variant]} ${className}`}
      {...props}
    />
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-lg bg-panel-2 border border-edge px-3 py-2 text-sm text-gray-100 placeholder-gray-500 outline-none focus:border-accent ${props.className ?? ""}`}
    />
  );
}

export function Select({
  value,
  onChange,
  options,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="w-full rounded-lg bg-panel-2 border border-edge px-3 py-2 text-sm text-gray-100 outline-none focus:border-accent disabled:opacity-50"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl bg-panel border border-edge p-5 ${className}`}>{children}</div>
  );
}

export function Badge({
  children,
  tone = "gray",
}: {
  children: ReactNode;
  tone?: "gray" | "green" | "yellow" | "red" | "blue";
}) {
  const tones: Record<string, string> = {
    gray: "bg-gray-500/15 text-gray-300",
    green: "bg-emerald-500/15 text-emerald-300",
    yellow: "bg-amber-500/15 text-amber-300",
    red: "bg-rec/15 text-rec",
    blue: "bg-accent/15 text-blue-300",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function statusTone(status: string): "gray" | "green" | "yellow" | "red" | "blue" {
  if (["ready", "complete", "caught_up"].includes(status)) return "green";
  if (["failed", "delayed"].includes(status)) return "red";
  if (["processing", "uploading", "uploaded", "queued"].includes(status)) return "yellow";
  if (["recording"].includes(status)) return "red";
  return "gray";
}

export function Spinner() {
  return (
    <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-500 border-t-white" />
  );
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
