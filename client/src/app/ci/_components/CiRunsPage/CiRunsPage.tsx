/* CiRunsPage — /ci page (AC-12). Lists every workspace CI run (`source='ci'`),
   filterable by Repository (free text) and Agent (dropdown). Rows link out to
   the GitHub Actions job (`ci_run.github_url`). */
"use client";

import type { CSSProperties } from "react";
import React from "react";
import { useTranslations } from "next-intl";
import { Badge, EmptyState, ErrorState, MonoLink, SelectInput, Skeleton, TextInput } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { RunCostBadge } from "@/components/RunCostBadge";
import { useAgents } from "@/lib/hooks/agents";
import { useWorkspaceCiRuns } from "@/lib/hooks/useCi";
import { formatDuration, statusMeta } from "./helpers";

const th: CSSProperties = {
  textAlign: "left",
  padding: "8px 12px",
  fontSize: 12,
  fontWeight: 600,
  color: "var(--text-muted)",
  borderBottom: "1px solid var(--border)",
  whiteSpace: "nowrap",
};

const td: CSSProperties = {
  padding: "10px 12px",
  fontSize: 13,
  color: "var(--text-secondary)",
  borderBottom: "1px solid var(--border)",
  whiteSpace: "nowrap",
};

export function CiRunsPage() {
  const t = useTranslations("ci");
  const [repoFilter, setRepoFilter] = React.useState("");
  const [agentFilter, setAgentFilter] = React.useState("");

  const { data: agents } = useAgents();
  const { data: runs, isLoading, isError, refetch } = useWorkspaceCiRuns({
    repo: repoFilter,
    agent_id: agentFilter || undefined,
  });

  const agentOptions = [
    { value: "", label: t("runsPage.filters.allAgents") },
    ...(agents ?? []).map((a) => ({ value: a.id, label: a.name })),
  ];

  const crumb = [{ label: t("page.crumb") }];
  const hasRuns = (runs?.length ?? 0) > 0;

  return (
    <AppShell crumb={crumb}>
      <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 700 }}>{t("runsPage.title")}</h1>
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 2 }}>{t("runsPage.subtitle")}</p>
        </div>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <div style={{ width: 260 }}>
            <TextInput value={repoFilter} onChange={setRepoFilter} placeholder={t("runsPage.filters.repoPlaceholder")} />
          </div>
          <div style={{ width: 220 }}>
            <SelectInput value={agentFilter} onChange={setAgentFilter} options={agentOptions} mono={false} />
          </div>
        </div>

        {isLoading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Skeleton height={36} />
            <Skeleton height={36} />
            <Skeleton height={36} />
          </div>
        )}

        {isError && <ErrorState body={t("runsPage.loadError")} onRetry={() => refetch()} />}

        {!isLoading && !isError && !hasRuns && (
          <EmptyState icon="Workflow" title={t("runsPage.emptyTitle")} body={t("runsPage.emptyBody")} />
        )}

        {!isLoading && !isError && hasRuns && (
          <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <caption style={{ position: "absolute", width: 1, height: 1, overflow: "hidden" }}>
                {t("runsPage.title")}
              </caption>
              <thead>
                <tr>
                  <th scope="col" style={th}>
                    {t("runsPage.table.repository")}
                  </th>
                  <th scope="col" style={th}>
                    {t("runsPage.table.agent")}
                  </th>
                  <th scope="col" style={th}>
                    {t("runsPage.table.status")}
                  </th>
                  <th scope="col" style={th}>
                    {t("runsPage.table.findings")}
                  </th>
                  <th scope="col" style={th}>
                    {t("runsPage.table.cost")}
                  </th>
                  <th scope="col" style={th}>
                    {t("runsPage.table.duration")}
                  </th>
                  <th scope="col" style={th}>
                    {t("runsPage.table.job")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {(runs ?? []).map((run) => {
                  const meta = statusMeta(run.status);
                  const statusLabel = meta.labelKey ? t(`runsPage.status.${meta.labelKey}`) : (run.status ?? "—");
                  return (
                    <tr key={run.id}>
                      <td style={td}>{run.repo ?? "—"}</td>
                      <td style={td}>{run.agent ?? "—"}</td>
                      <td style={td}>
                        <Badge color={meta.color} icon={meta.icon}>
                          {statusLabel}
                        </Badge>
                      </td>
                      <td style={td}>{run.findings_count ?? "—"}</td>
                      <td style={td}>
                        <RunCostBadge costUsd={run.cost_usd} />
                      </td>
                      <td style={td}>{formatDuration(run.duration_s)}</td>
                      <td style={td}>{run.github_url ? <MonoLink href={run.github_url}>{t("runsPage.view")}</MonoLink> : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
