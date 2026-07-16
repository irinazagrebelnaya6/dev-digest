/* AgentTabs — Multi-Agent Review Tabs mode (SPEC-06 AC-13, AC-16). One tab per
   agent; the active tab lists that agent's findings via `FindingDetail`. The
   short `AgentColumnFinding` list (from the results read model) is correlated
   back to its full, persisted `FindingRecord` (rationale/suggestion/
   confidence/accepted_at/dismissed_at) via the existing `usePrReviews(prId)` —
   one review row per run, matched by `run_id` — instead of widening the
   results contract. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { CircularScore, MonoLink, Tabs } from "@devdigest/ui";
import type { AgentColumn } from "@devdigest/shared";
import { usePrReviews } from "@/lib/hooks/reviews";
import { formatEstimateCost, formatEstimateTime } from "@/lib/hooks/multi-agent";
import { FindingDetail } from "../FindingDetail";
import { s } from "./styles";

export function AgentTabs({
  prId,
  columns,
  onViewTrace,
}: {
  prId: string;
  columns: AgentColumn[];
  /** Opens the existing `RunTraceDrawer` for the active tab's run (same drawer
     Columns mode uses). */
  onViewTrace?: (runId: string) => void;
}) {
  const t = useTranslations("multiAgent");
  const [active, setActive] = React.useState<string>(columns[0]?.agent_id ?? "");
  const { data: reviews } = usePrReviews(prId);

  if (columns.length === 0) return null;
  const activeColumn = columns.find((c) => c.agent_id === active) ?? columns[0]!;

  const fullFindings = (reviews ?? []).find((r) => r.run_id === activeColumn.run_id)?.findings ?? [];

  return (
    <div>
      <Tabs
        tabs={columns.map((c) => ({ key: c.agent_id, label: c.agent_name, count: c.findings.length }))}
        value={activeColumn.agent_id}
        onChange={setActive}
        pad="0"
      />

      <div style={s.summaryCard}>
        {activeColumn.score != null && <CircularScore score={activeColumn.score} size={44} />}
        <div style={s.summaryInfo}>
          <div style={s.summaryName}>{activeColumn.agent_name}</div>
          {activeColumn.summary && <div style={s.summaryText}>{activeColumn.summary}</div>}
        </div>
        <div style={s.summaryMeta}>
          <MonoLink onClick={() => onViewTrace?.(activeColumn.run_id)}>{t("results.viewTrace")}</MonoLink>
          <span className="mono tnum" style={s.summaryMetaLine}>
            {activeColumn.duration_ms != null ? formatEstimateTime(activeColumn.duration_ms) : "—"}
            {" · "}
            {activeColumn.cost_usd != null ? formatEstimateCost(activeColumn.cost_usd) : "—"}
          </span>
        </div>
      </div>

      <div style={s.list}>
        {fullFindings.length === 0 ? (
          <div style={s.empty}>{t("results.noFindings")}</div>
        ) : (
          fullFindings.map((f, i) => (
            <FindingDetail key={f.id} finding={f} prId={prId} defaultExpanded={i === 0} />
          ))
        )}
      </div>
    </div>
  );
}
