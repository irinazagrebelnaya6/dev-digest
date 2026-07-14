/* AgentDashboardRow — one row of the top-level Eval Dashboard's agent list
   (AC-15). Self-fetching (takes only the agent, calls its own dashboard hook)
   so the parent list doesn't need to call a hook per array item — mirrors the
   "self-fetching tab cards" convention (see client/INSIGHTS.md). */
"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { EVAL_METRIC_COLOR, Icon, Skeleton, Sparkline } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import { readActualOutput, useAgentEvalDashboard } from "@/lib/hooks/evals";
import { s } from "./styles";

export function AgentDashboardRow({ agent }: { agent: Agent }) {
  const t = useTranslations("eval");
  const { data, isLoading } = useAgentEvalDashboard(agent.id);

  if (isLoading || !data) {
    return <Skeleton height={72} />;
  }

  if (data.cases_total === 0) {
    return (
      <Link href={`/evals/${agent.id}`} style={s.row}>
        <Icon.Cpu size={16} style={{ color: "var(--accent)" }} />
        <div style={s.info}>
          <span style={s.name}>{agent.name}</span>
          <span style={s.meta}>{t("dashboard.noCasesYet")}</span>
        </div>
        <Icon.ChevronRight size={16} style={{ color: "var(--text-muted)" }} />
      </Link>
    );
  }

  const lastRun = data.recent_runs[0];

  return (
    <Link href={`/evals/${agent.id}`} style={s.row}>
      <Icon.Cpu size={16} style={{ color: "var(--accent)" }} />
      <div style={s.info}>
        <div style={s.nameRow}>
          <span style={s.name}>{agent.name}</span>
          <span className="mono" style={s.modelBadge}>
            {agent.model}
          </span>
        </div>
        <span style={s.meta}>
          {lastRun
            ? t("dashboard.lastRunSummary", {
                version: readActualOutput(lastRun).meta?.agent_version ?? agent.version,
                date: new Date(lastRun.ran_at).toLocaleString(),
                passed: data.current.traces_passed,
                total: data.current.traces_total,
              })
            : t("dashboard.neverRunAgent")}
        </span>
      </div>
      <Sparkline data={data.trend.map((p) => p.recall)} color={EVAL_METRIC_COLOR.recall} w={64} h={22} />
      <div style={s.metrics}>
        <Metric label={t("dashboard.metrics.recall")} value={data.current.recall} color={EVAL_METRIC_COLOR.recall} />
        <Metric label={t("dashboard.metrics.precision")} value={data.current.precision} color={EVAL_METRIC_COLOR.precision} />
        <Metric
          label={t("dashboard.metrics.citationAccuracy")}
          value={data.current.citation_accuracy}
          color={EVAL_METRIC_COLOR.citation_accuracy}
        />
      </div>
      <Icon.ChevronRight size={16} style={{ color: "var(--text-muted)" }} />
    </Link>
  );
}

function Metric({ label, value, color }: { label: string; value: number | null; color: string }) {
  return (
    <div style={s.metric}>
      <span style={s.metricLabel}>{label}</span>
      <span className="tnum" style={{ ...s.metricValue, color }}>
        {value == null ? "—" : `${Math.round(value * 100)}%`}
      </span>
    </div>
  );
}
