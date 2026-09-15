import type { ComponentType } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  CloudOff,
  HardDrive,
  MinusCircle,
  Pause,
  Radio,
  RotateCcw,
} from "lucide-react";

// Explicit, accessible status vocabulary. Every badge pairs an icon + a text
// label so meaning never depends on colour alone (WCAG 1.4.1).
export type StatusKind =
  | "idle"
  | "recording"
  | "paused"
  | "completed"
  | "interrupted"
  | "local_only"
  | "upload_not_connected"
  | "failed"
  | "recovered"
  | "unavailable"
  | "synced"
  | "not_connected";

type BadgeConfig = { label: string; icon: ComponentType<{ className?: string }>; className: string };

const CONFIG: Record<StatusKind, BadgeConfig> = {
  idle: { label: "Idle", icon: Clock, className: "border-[#d4d2c8] bg-[#f0efe9] text-[#5c5f56] dark:border-[#2e342a] dark:bg-[#1f241d] dark:text-[#a1a69b]" },
  recording: { label: "Recording", icon: Radio, className: "border-[#e0b9ad] bg-[#f6e6e0] text-[#8a2f2f] dark:border-[#5c2722] dark:bg-[#2c1816] dark:text-[#e89b94]" },
  paused: { label: "Paused", icon: Pause, className: "border-[#c5a25f] bg-[#f7ecd5] text-[#7a5a1a] dark:border-[#5c461d] dark:bg-[#292314] dark:text-[#dec078]" },
  completed: { label: "Completed", icon: CheckCircle2, className: "border-[#c3cc8f] bg-[#eef0df] text-[#465418] dark:border-[#42542f] dark:bg-[#232f1b] dark:text-[#b4cc84]" },
  interrupted: { label: "Interrupted", icon: AlertTriangle, className: "border-[#c5a25f] bg-[#f7ecd5] text-[#7a5a1a] dark:border-[#5c461d] dark:bg-[#292314] dark:text-[#dec078]" },
  local_only: { label: "Local only", icon: HardDrive, className: "border-[#c9c8be] bg-[#eceadf] text-[#4f5341] dark:border-[#384033] dark:bg-[#20251d] dark:text-[#b6beaa]" },
  upload_not_connected: { label: "Not connected", icon: CloudOff, className: "border-[#d4d2c8] bg-[#f0efe9] text-[#5c5f56] dark:border-[#2e342a] dark:bg-[#1f241d] dark:text-[#a1a69b]" },
  failed: { label: "Failed", icon: AlertTriangle, className: "border-[#e0b9ad] bg-[#f6e6e0] text-[#8a2f2f] dark:border-[#5c2722] dark:bg-[#2c1816] dark:text-[#e89b94]" },
  recovered: { label: "Recovered", icon: RotateCcw, className: "border-[#bcd8c4] bg-[#e2efe6] text-[#2f6b50] dark:border-[#2b543c] dark:bg-[#17281d] dark:text-[#82d4a6]" },
  unavailable: { label: "Unavailable", icon: MinusCircle, className: "border-[#d4d2c8] bg-[#f0efe9] text-[#6c7068] dark:border-[#2e342a] dark:bg-[#1f241d] dark:text-[#a1a69b]" },
  synced: { label: "Synced", icon: CheckCircle2, className: "border-[#bcd8c4] bg-[#e2efe6] text-[#2f6b50] dark:border-[#2b543c] dark:bg-[#17281d] dark:text-[#82d4a6]" },
  not_connected: { label: "Not connected", icon: CloudOff, className: "border-[#d4d2c8] bg-[#f0efe9] text-[#5c5f56] dark:border-[#2e342a] dark:bg-[#1f241d] dark:text-[#a1a69b]" },
};

type Props = {
  kind: StatusKind;
  /** Optional descriptive prefix, e.g. "Upload" → "Upload: Not connected". */
  prefix?: string;
  className?: string;
};

export function StatusBadge({ kind, prefix, className }: Props) {
  const config = CONFIG[kind] ?? CONFIG.unavailable;
  const Icon = config.icon;
  const text = prefix ? `${prefix}: ${config.label}` : config.label;
  return (
    <span
      role="status"
      aria-label={text}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${config.className} ${className ?? ""}`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>{text}</span>
    </span>
  );
}

export default StatusBadge;
