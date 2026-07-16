/* AgentColumns — Multi-Agent Review Columns mode (SPEC-06 AC-13..15). One
   lane per agent; header shows LIVE status (icon + text, never color alone)
   sourced from the existing SSE `useRunEvents`, plus duration/cost; a "View
   trace" link opens the existing `RunTraceDrawer` for that agent's run. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { Icon, MonoLink, SeverityBadge, type Severity } from "@devdigest/ui";
import type { AgentColumn } from "@devdigest/shared";
import { useRunEvents } from "@/lib/hooks/reviews";
import { formatEstimateCost, formatEstimateTime } from "@/lib/hooks/multi-agent";
import { queryKeys } from "@/lib/query-keys";
import { agentAccent, STATUS_META } from "./helpers";
import { s } from "./styles";

export function AgentColumns({
  runId,
  columns,
  onViewTrace,
}: {
  runId: string;
  columns: AgentColumn[];
  onViewTrace: (runId: string) => void;
}) {
  return (
    <div style={s.wrap}>
      {columns.map((c) => (
        <AgentColumnCard key={c.run_id} runId={runId} column={c} onViewTrace={() => onViewTrace(c.run_id)} />
      ))}
    </div>
  );
}

function AgentColumnCard({
  runId,
  column,
  onViewTrace,
}: {
  runId: string;
  column: AgentColumn;
  onViewTrace: () => void;
}) {
  const t = useTranslations("multiAgent");
  const qc = useQueryClient();
  const isRunning = column.status === "running";
  const { running: liveRunning } = useRunEvents(isRunning ? [column.run_id] : []);
  const wasRunning = React.useRef(liveRunning);

  React.useEffect(() => {
    if (wasRunning.current && !liveRunning) {
      // The SSE stream closed — refresh the multi-agent run read model right
      // away instead of waiting for the next poll tick.
      qc.invalidateQueries({ queryKey: queryKeys.multiAgentRun(runId) });
    }
    wasRunning.current = liveRunning;
  }, [liveRunning, qc, runId]);

  const meta = STATUS_META[column.status];
  const StatusIcon = Icon[meta.icon];
  const accent = agentAccent(column.agent_name);

  return (
    <div style={s.card(accent)} data-agent-status={column.status}>
      <div style={s.header}>
        <div style={s.headerInfo}>
          <span style={s.name}>{column.agent_name}</span>
          <span style={s.statusLine(meta.color)} data-testid="column-status">
            <StatusIcon size={12} style={isRunning ? { animation: "ddspin 1s linear infinite" } : undefined} />
            {t(`results.${meta.labelKey}`)}
          </span>
          <span style={s.metaLine} className="mono tnum">
            {column.duration_ms != null ? formatEstimateTime(column.duration_ms) : "—"}
            {" · "}
            {column.cost_usd != null ? formatEstimateCost(column.cost_usd) : "—"}
          </span>
        </div>
      </div>

      <div style={s.findings}>
        {column.findings.length === 0 ? (
          <div style={s.empty}>{t("results.noFindings")}</div>
        ) : (
          column.findings.map((f) => (
            <div key={f.id} style={s.findingRow} data-finding-id={f.id}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <SeverityBadge severity={f.severity as Severity} compact />
                <span style={s.findingTitle}>{f.title}</span>
              </div>
              {/* Untrusted (agent-derived) file path — no repo/head-sha context on
                 this page, so it renders as inert mono text (no href), never HTML. */}
              <MonoLink>
                {f.file}:{f.start_line}
              </MonoLink>
            </div>
          ))
        )}
      </div>

      <div style={s.footer}>
        <MonoLink onClick={onViewTrace}>{t("results.viewTrace")}</MonoLink>
        <span style={s.footerCount}>{t("results.findingsCount", { count: column.findings.length })}</span>
      </div>
    </div>
  );
}
