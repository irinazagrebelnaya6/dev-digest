import type { IconName } from "@devdigest/ui";
import type { AgentColumn } from "@devdigest/shared";

export type ColumnStatus = AgentColumn["status"];

/** Status → icon + color, never color alone (AC-14 a11y). Label text comes
   from the `multiAgent.results.status*` translation keys at the call site. */
export const STATUS_META: Record<ColumnStatus, { icon: IconName; color: string; labelKey: "statusRunning" | "statusDone" | "statusFailed" }> = {
  running: { icon: "RefreshCw", color: "var(--accent)", labelKey: "statusRunning" },
  done: { icon: "CheckCircle", color: "var(--ok)", labelKey: "statusDone" },
  failed: { icon: "XCircle", color: "var(--crit)", labelKey: "statusFailed" },
};

/** Same deterministic-hue idea as the `Avatar` primitive, reused here for the
   column's top accent border so each agent reads as a distinct lane. */
const HUES = ["#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899", "#14b8a6"];
export function agentAccent(name: string): string {
  return HUES[name.charCodeAt(0) % HUES.length]!;
}
