/* EvalDashboardView — top-level Eval Dashboard (AC-15, AC-17). Per-agent
   trend list ("Run all agents"), and a workspace-wide "Recent eval runs · all
   agents" table, newest first. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, EVAL_METRIC_COLOR, ProgressBar, SectionLabel, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { useAgents } from "@/lib/hooks/agents";
import { useEvalDashboard, useRunAllAgents, groupRunsByBatch } from "@/lib/hooks/evals";
import { useToast } from "@/lib/toast";
import { AgentDashboardRow } from "./_components/AgentDashboardRow";
import { agentNameMap, formatCost } from "./helpers";
import { s } from "./styles";

export function EvalDashboardView() {
  const t = useTranslations("eval");
  const toast = useToast();
  const { data: agents, isLoading: agentsLoading, isError: agentsError, refetch } = useAgents();
  const { data: dashboard, isLoading: dashboardLoading } = useEvalDashboard();
  const runAllAgents = useRunAllAgents();

  const nameById = React.useMemo(() => agentNameMap(agents), [agents]);
  const batches = React.useMemo(() => groupRunsByBatch(dashboard?.recent_runs), [dashboard]);

  const handleRunAllAgents = async () => {
    try {
      await runAllAgents.mutateAsync();
      toast.success(t("dashboard.runAllAgents"));
    } catch {
      /* surfaced via the global mutationCache.onError toast */
    }
  };

  return (
    <AppShell crumb={[{ label: t("page.crumbSkillsLab") }, { label: t("page.crumbEvalDashboard") }]}>
      <div style={s.page}>
        <div style={s.header}>
          <div>
            <h1 style={s.h1}>{t("dashboard.defaultTitle")}</h1>
            <p style={s.subtitle}>{t("dashboard.subtitle")}</p>
          </div>
          <Button
            kind="primary"
            icon="Play"
            loading={runAllAgents.isPending}
            disabled={runAllAgents.isPending}
            onClick={handleRunAllAgents}
          >
            {runAllAgents.isPending ? t("dashboard.runningAllAgents") : t("dashboard.runAllAgents")}
          </Button>
        </div>

        <section>
          <SectionLabel icon="Cpu">{t("dashboard.agentsHeading")}</SectionLabel>
          {agentsLoading && (
            <div style={s.list}>
              <Skeleton height={72} />
              <Skeleton height={72} />
            </div>
          )}
          {agentsError && <ErrorState body="Could not load agents." onRetry={() => refetch()} />}
          {!agentsLoading && !agentsError && (agents ?? []).length === 0 && (
            <EmptyState icon="Cpu" title="No agents yet" />
          )}
          {!agentsLoading && !agentsError && (agents ?? []).length > 0 && (
            <div style={s.list}>
              {(agents ?? []).map((a) => (
                <AgentDashboardRow key={a.id} agent={a} />
              ))}
            </div>
          )}
        </section>

        <section>
          <SectionLabel icon="History">{t("dashboard.recentRunsAllAgents")}</SectionLabel>
          {dashboardLoading && <Skeleton height={200} />}
          {!dashboardLoading && batches.length === 0 && <EmptyState icon="History" title={t("dashboard.noRuns")} />}
          {!dashboardLoading && batches.length > 0 && (
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>{t("dashboard.table.agent")}</th>
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
                    <td style={s.td}>{(b.agent_id && nameById.get(b.agent_id)) || "—"}</td>
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
      </div>
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
