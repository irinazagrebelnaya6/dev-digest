/* AgentEvalDetailView — per-agent Eval Dashboard detail (AC-18). Current
   recall/precision/citation_accuracy with deltas vs. the prior batch, a
   metric-trend line chart over time, a "Recent runs" table (checkboxes +
   Compare), and Compare-runs / Promote (AC-12/13/14). */
"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  Badge,
  Button,
  Checkbox,
  EmptyState,
  ErrorState,
  EVAL_METRIC_COLOR,
  Icon,
  LineChart,
  MetricCard,
  ProgressBar,
  SectionLabel,
  Skeleton,
} from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { useAgent } from "@/lib/hooks/agents";
import { useAgentEvalDashboard, useAgentEvalRuns, useRunAgentEvalCases, groupRunsByBatch, pctOrDash } from "@/lib/hooks/evals";
import { useToast } from "@/lib/toast";
import { CompareRunsModal } from "./_components/CompareRunsModal";
import { formatCost, toggleCompareSelection } from "./helpers";
import { s } from "./styles";

export function AgentEvalDetailView({ agentId }: { agentId: string }) {
  const t = useTranslations("eval");
  const toast = useToast();
  const { data: agent, isLoading: agentLoading, isError: agentError, refetch } = useAgent(agentId);
  const { data: dashboard, isLoading: dashboardLoading } = useAgentEvalDashboard(agentId);
  const { data: runs } = useAgentEvalRuns(agentId);
  const runAll = useRunAgentEvalCases(agentId);

  const [selected, setSelected] = React.useState<string[]>([]);
  const [comparing, setComparing] = React.useState(false);

  const batches = React.useMemo(() => groupRunsByBatch(runs), [runs]);

  const handleRun = async () => {
    try {
      await runAll.mutateAsync();
      toast.success(t("dashboard.runEval", { count: dashboard?.cases_total ?? 0 }));
    } catch {
      /* surfaced via the global mutationCache.onError toast */
    }
  };

  const [batchAId, batchBId] = React.useMemo(() => {
    if (selected.length !== 2) return [undefined, undefined] as const;
    const rows = selected
      .map((id) => batches.find((b) => b.batch_id === id))
      .filter((b): b is NonNullable<typeof b> => !!b)
      .sort((a, b) => (a.ran_at < b.ran_at ? -1 : 1));
    return [rows[0]?.batch_id, rows[1]?.batch_id] as const;
  }, [selected, batches]);

  if (agentError || (!agentLoading && !agent)) {
    return (
      <AppShell crumb={[{ label: t("page.crumbSkillsLab") }, { label: t("page.crumbEvalDashboard"), href: "/evals" }]}>
        <ErrorState fullScreen title="Couldn't load this agent" onRetry={() => refetch()} />
      </AppShell>
    );
  }

  return (
    <AppShell
      crumb={[
        { label: t("page.crumbSkillsLab") },
        { label: t("page.crumbEvalDashboard"), href: "/evals" },
        { label: agent?.name ?? "" },
      ]}
    >
      <div style={s.page}>
        <Link href="/evals" style={s.back}>
          <Icon.ChevronLeft size={14} />
          {t("dashboard.backToAgents")}
        </Link>

        {agentLoading || !agent ? (
          <Skeleton height={60} />
        ) : (
          <div style={s.header}>
            <div>
              <div style={s.titleRow}>
                <h1 style={s.h1}>{agent.name}</h1>
                <Badge color="var(--text-secondary)" mono>
                  {agent.model}
                </Badge>
              </div>
              <p style={s.subtitle}>
                {t("dashboard.detailSubtitle", {
                  runs: batches.length,
                  cases: dashboard?.cases_total ?? 0,
                })}
              </p>
            </div>
            <Button kind="primary" icon="Play" loading={runAll.isPending} disabled={runAll.isPending} onClick={handleRun}>
              {runAll.isPending ? t("dashboard.running") : t("dashboard.runEval", { count: dashboard?.cases_total ?? 0 })}
            </Button>
          </div>
        )}

        {dashboard?.alert && (
          <div style={s.alertBanner} role="status">
            <Icon.AlertTriangle size={16} style={{ color: "var(--warn)", flexShrink: 0 }} />
            <span>{dashboard.alert}</span>
          </div>
        )}

        {dashboardLoading && (
          <div style={s.metricsRow}>
            <Skeleton height={110} />
            <Skeleton height={110} />
            <Skeleton height={110} />
          </div>
        )}

        {!dashboardLoading && dashboard && dashboard.cases_total === 0 && (
          <EmptyState icon="Gauge" title={t("dashboard.noCasesYet")} body={t("evalsTab.emptyCases")} />
        )}

        {!dashboardLoading && dashboard && dashboard.cases_total > 0 && (
          <>
            <div style={s.metricsRow}>
              <MetricCard
                label={t("dashboard.metrics.recall")}
                value={pctOrDash(dashboard.current.recall)}
                delta={dashboard.delta.recall}
                color={EVAL_METRIC_COLOR.recall}
                trend={dashboard.trend.map((p) => p.recall)}
              />
              <MetricCard
                label={t("dashboard.metrics.precision")}
                value={pctOrDash(dashboard.current.precision)}
                delta={dashboard.delta.precision}
                color={EVAL_METRIC_COLOR.precision}
                trend={dashboard.trend.map((p) => p.precision)}
              />
              <MetricCard
                label={t("dashboard.metrics.citationAccuracy")}
                value={pctOrDash(dashboard.current.citation_accuracy)}
                delta={dashboard.delta.citation_accuracy}
                color={EVAL_METRIC_COLOR.citation_accuracy}
                trend={dashboard.trend.map((p) => p.citation_accuracy)}
              />
            </div>

            <section>
              <SectionLabel
                icon="TrendingUp"
                right={
                  <div style={s.chartLegend}>
                    <span style={s.legendItem}>
                      <span style={s.legendDot(EVAL_METRIC_COLOR.recall)} />
                      {t("dashboard.legend.recall")}
                    </span>
                    <span style={s.legendItem}>
                      <span style={s.legendDot(EVAL_METRIC_COLOR.precision)} />
                      {t("dashboard.legend.precision")}
                    </span>
                    <span style={s.legendItem}>
                      <span style={s.legendDot(EVAL_METRIC_COLOR.citation_accuracy)} />
                      {t("dashboard.legend.citation")}
                    </span>
                  </div>
                }
              >
                {t("dashboard.metricTrend")}
              </SectionLabel>
              {dashboard.trend.length >= 2 ? (
                <LineChart
                  w={900}
                  series={[
                    { name: "recall", color: EVAL_METRIC_COLOR.recall, data: dashboard.trend.map((p) => p.recall) },
                    { name: "precision", color: EVAL_METRIC_COLOR.precision, data: dashboard.trend.map((p) => p.precision) },
                    {
                      name: "citation",
                      color: EVAL_METRIC_COLOR.citation_accuracy,
                      data: dashboard.trend.map((p) => p.citation_accuracy),
                    },
                  ]}
                />
              ) : (
                <EmptyState icon="TrendingUp" title={t("dashboard.noRuns")} />
              )}
            </section>

            <section>
              <div style={s.runsHeader}>
                <SectionLabel icon="History">
                  {t("dashboard.recentRuns")}
                  {selected.length > 0 && (
                    <span style={{ marginLeft: 8, color: "var(--text-muted)", fontWeight: 400 }}>
                      {t("dashboard.table.selected", { count: selected.length })}
                    </span>
                  )}
                </SectionLabel>
                <Button
                  kind="primary"
                  size="sm"
                  icon="GitMerge"
                  disabled={selected.length !== 2}
                  onClick={() => setComparing(true)}
                >
                  {t("dashboard.table.compare")}
                </Button>
              </div>

              {batches.length === 0 && <EmptyState icon="History" title={t("dashboard.noRuns")} />}
              {batches.length > 0 && (
                <table style={s.table}>
                  <thead>
                    <tr>
                      <th style={s.th} />
                      <th style={s.th}>{t("dashboard.table.ranAt")}</th>
                      <th style={s.th}>{t("dashboard.table.version")}</th>
                      <th style={s.th}>{t("dashboard.table.recall")}</th>
                      <th style={s.th}>{t("dashboard.table.precision")}</th>
                      <th style={s.th}>{t("dashboard.table.citation")}</th>
                      <th style={s.th}>{t("dashboard.table.pass")}</th>
                      <th style={s.th}>{t("dashboard.table.cost")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batches.map((b) => (
                      <tr key={b.batch_id}>
                        <td style={s.td}>
                          <Checkbox
                            checked={selected.includes(b.batch_id)}
                            onChange={() => setSelected((prev) => toggleCompareSelection(prev, b.batch_id))}
                          />
                        </td>
                        <td style={s.td}>{new Date(b.ran_at).toLocaleString()}</td>
                        <td className="mono" style={s.td}>
                          {b.agent_version != null ? `v${b.agent_version}` : "—"}
                        </td>
                        <MetricCell value={b.recall} color={EVAL_METRIC_COLOR.recall} />
                        <MetricCell value={b.precision} color={EVAL_METRIC_COLOR.precision} />
                        <MetricCell value={b.citation_accuracy} color={EVAL_METRIC_COLOR.citation_accuracy} />
                        <td className="tnum" style={s.td}>
                          {b.passed}/{b.total}
                        </td>
                        <td className="tnum" style={s.td}>
                          {formatCost(b.cost_usd)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </>
        )}
      </div>

      {comparing && agent && batchAId && batchBId && (
        <CompareRunsModal agent={agent} batchA={batchAId} batchB={batchBId} onClose={() => setComparing(false)} />
      )}
    </AppShell>
  );
}

function MetricCell({ value, color }: { value: number | null; color: string }) {
  if (value == null) {
    return (
      <td style={s.td}>
        <span style={{ color: "var(--text-muted)" }}>—</span>
      </td>
    );
  }
  const pct = Math.round(value * 100);
  return (
    <td style={s.td}>
      <div style={s.barCell}>
        <div style={s.barTrack}>
          <ProgressBar value={pct} color={color} />
        </div>
        <span className="tnum" style={{ fontWeight: 600, minWidth: 34 }}>
          {pct}%
        </span>
      </div>
    </td>
  );
}
