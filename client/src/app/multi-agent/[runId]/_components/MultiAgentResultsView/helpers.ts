import type { IconName } from "@devdigest/ui";
import type { MultiAgentStatus } from "@devdigest/shared";

/** Overall multi-run status → icon + color, never color alone (AC-12 surfaced
   to the results header). Label text comes from the `multiAgent.results.status*`
   translation keys at the call site — mirrors `AgentColumns/helpers.ts`'s
   per-column `STATUS_META`. */
export const RUN_STATUS_META: Record<
  MultiAgentStatus,
  { icon: IconName; color: string; labelKey: "statusRunning" | "statusDone" | "statusPartial" | "statusFailed" }
> = {
  running: { icon: "RefreshCw", color: "var(--accent)", labelKey: "statusRunning" },
  done: { icon: "CheckCircle", color: "var(--ok)", labelKey: "statusDone" },
  partial: { icon: "AlertTriangle", color: "var(--warn)", labelKey: "statusPartial" },
  failed: { icon: "XCircle", color: "var(--crit)", labelKey: "statusFailed" },
};
