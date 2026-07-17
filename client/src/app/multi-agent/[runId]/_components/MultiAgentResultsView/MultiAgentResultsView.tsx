/* MultiAgentResultsView — Multi-Agent Review results page (SPEC-06 AC-13..22).
   Orchestrates the Columns/Tabs toggle, "Where agents disagree", the 1-vs-N
   economics view, and the run-trace drawer (reused from the PR page). */
"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { usePrReviews } from "@/lib/hooks/reviews";
import { useMultiAgentEconomics, useMultiAgentRun, formatEstimateCost, formatEstimateTime } from "@/lib/hooks/multi-agent";
import { RunTraceDrawer } from "@/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer";
import { ModeToggle, type ResultsMode } from "../ModeToggle";
import { AgentColumns } from "../AgentColumns";
import { AgentTabs } from "../AgentTabs";
import { AgentsDisagree } from "../AgentsDisagree";
import { EconomicsCompare } from "../EconomicsCompare";
import { RUN_STATUS_META } from "./helpers";
import { s } from "./styles";

export function MultiAgentResultsView({ runId }: { runId: string }) {
  const t = useTranslations("multiAgent");
  const router = useRouter();
  const search = useSearchParams();
  const [mode, setMode] = React.useState<ResultsMode>("columns");
  const { data: run, isLoading, isError, refetch } = useMultiAgentRun(runId);
  const { data: economics } = useMultiAgentEconomics(runId);
  const { data: reviews } = usePrReviews(run?.pr_id ?? null);

  const traceRunId = search.get("trace");
  const setTraceRunId = (id: string | null) => {
    const sp = new URLSearchParams(search.toString());
    if (id == null) sp.delete("trace");
    else sp.set("trace", id);
    router.replace(`/multi-agent/${runId}${sp.toString() ? `?${sp.toString()}` : ""}`);
  };

  const crumb = [
    { label: t("results.crumb"), href: "/multi-agent" },
    { label: run?.pr_number != null ? `#${run.pr_number}` : runId, mono: true },
  ];

  if (isLoading) {
    return (
      <AppShell crumb={crumb}>
        <div style={s.page}>
          <Skeleton height={28} width={320} />
          <Skeleton height={200} />
        </div>
      </AppShell>
    );
  }

  if (isError || !run) {
    return (
      <AppShell crumb={crumb}>
        <ErrorState fullScreen title={t("results.loadError")} body={t("results.notFound")} onRetry={() => refetch()} />
      </AppShell>
    );
  }

  const traceColumn = run.columns.find((c) => c.run_id === traceRunId);
  const traceFindings = (reviews ?? []).find((r) => r.run_id === traceRunId)?.findings ?? [];

  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        <div style={s.topRow}>
          <Button kind="secondary" size="sm" icon="Settings" onClick={() => router.push("/multi-agent")}>
            {t("configure.crumbConfigure")}
          </Button>
          <ModeToggle mode={mode} onChange={setMode} />
        </div>

        <div style={s.titleGroup}>
          <h1 style={s.h1}>{t("results.title")}</h1>
          <span style={s.subtitle}>{t("results.selectedAgents", { count: run.agent_count })}</span>
        </div>

        <div style={s.metaRow}>
          <span style={s.fanOutSummary}>
            {t("results.fanOutSummary", {
              count: run.agent_count,
              time: formatEstimateTime(run.total_duration_ms),
              cost: run.total_cost_usd != null ? formatEstimateCost(run.total_cost_usd) : "—",
            })}
          </span>
          {(() => {
            const meta = RUN_STATUS_META[run.status];
            const StatusIcon = Icon[meta.icon];
            return (
              <span style={s.statusBadge(meta.color)} data-testid="run-status">
                <StatusIcon size={14} />
                {t(`results.${meta.labelKey}`)}
              </span>
            );
          })()}
        </div>

        {mode === "columns" ? (
          <AgentColumns runId={runId} columns={run.columns} onViewTrace={setTraceRunId} />
        ) : (
          <AgentTabs prId={run.pr_id} columns={run.columns} onViewTrace={setTraceRunId} />
        )}

        <AgentsDisagree conflicts={run.conflicts} />

        {economics && <EconomicsCompare economics={economics} agentCount={run.agent_count} />}
      </div>

      {traceRunId && (
        <RunTraceDrawer
          runId={traceRunId}
          prNumber={run.pr_number ?? null}
          agentName={traceColumn?.agent_name ?? null}
          findings={traceFindings}
          running={traceColumn?.status === "running"}
          onClose={() => setTraceRunId(null)}
        />
      )}
    </AppShell>
  );
}
