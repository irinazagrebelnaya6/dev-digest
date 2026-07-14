import type { Agent } from "@devdigest/shared";

/** `agent_id → name` map, built once per render (co-located display-only
 *  correlation, same "build a Map" pattern used by FindingsTab's run summary
 *  join — see client/INSIGHTS.md). */
export function agentNameMap(agents: Agent[] | undefined): Map<string, string> {
  return new Map((agents ?? []).map((a) => [a.id, a.name]));
}

/** `$0.0234` → `$0.02` (never `$0.00` for a nonzero cost, `—` for null) —
 *  mirrors the L01 Run Cost Badge formatting rule. */
export function formatCost(cost: number | null): string {
  if (cost == null) return "—";
  if (cost > 0 && cost < 0.01) return "<$0.01";
  return `$${cost.toFixed(2)}`;
}
