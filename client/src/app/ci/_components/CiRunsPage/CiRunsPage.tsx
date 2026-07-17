/* CiRunsPage — /ci page (AC-12). Lists every workspace CI run (`source='ci'`),
   filterable by Repository (free text) and Agent (dropdown). Rows link out to
   the GitHub Actions job (`ci_run.github_url`) and, clicked anywhere else, open
   the run-trace drawer (`?trace=<run.id>`, same pattern as MultiAgentResultsView). */
"use client";

import type { CSSProperties, KeyboardEvent } from "react";
import React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge, EmptyState, ErrorState, MonoLink, SelectInput, Skeleton, TextInput } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { RunCostBadge } from "@/components/RunCostBadge";
import { RunTraceDrawer } from "@/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer";
import { useAgents } from "@/lib/hooks/agents";
import { useRepos } from "@/lib/hooks/core";
import { useWorkspaceCiRuns } from "@/lib/hooks/useCi";
import { formatDuration, verdictMeta } from "./helpers";

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

const rowStyle: CSSProperties = {
  cursor: "pointer",
};

export function CiRunsPage() {
  const t = useTranslations("ci");
  const router = useRouter();
  const search = useSearchParams();
  const [repoFilter, setRepoFilter] = React.useState("");
  const [agentFilter, setAgentFilter] = React.useState("");

  const { data: agents } = useAgents();
  const { data: repos } = useRepos();
  const { data: runs, isLoading, isError, refetch } = useWorkspaceCiRuns({
    repo: repoFilter,
    agent_id: agentFilter || undefined,
  });

  // `run.repo` (a locally-tolerated `full_name` string, see useCi.ts) resolves
  // to a repoId — via the workspace's tracked repos — so the PR column can
  // link to the PR detail page. Repos not (yet) tracked in this workspace
  // render the PR number as plain text instead of a dead link.
  const repoIdByFullName = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const r of repos ?? []) map.set(r.full_name, r.id);
    return map;
  }, [repos]);

  const traceRunId = search.get("trace");
  const setTraceRunId = (id: string | null) => {
    const sp = new URLSearchParams(search.toString());
    if (id == null) sp.delete("trace");
    else sp.set("trace", id);
    router.replace(`/ci${sp.toString() ? `?${sp.toString()}` : ""}`);
  };
  const selectedRun = (runs ?? []).find((r) => r.id === traceRunId) ?? null;

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
                    {t("runsPage.table.pr")}
                  </th>
                  <th scope="col" style={th}>
                    {t("runsPage.table.repository")}
                  </th>
                  <th scope="col" style={th}>
                    {t("runsPage.table.agent")}
                  </th>
                  <th scope="col" style={th}>
                    {t("runsPage.table.verdict")}
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
                  const vMeta = verdictMeta(run.status);
                  const verdictLabel = vMeta.labelKey ? t(`runsPage.verdict.${vMeta.labelKey}`) : "—";
                  const repoId = run.repo ? repoIdByFullName.get(run.repo) : undefined;

                  const openTrace = () => setTraceRunId(run.id);
                  const handleRowKeyDown = (e: KeyboardEvent<HTMLTableRowElement>) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openTrace();
                    }
                  };

                  return (
                    <tr
                      key={run.id}
                      role="button"
                      tabIndex={0}
                      onClick={openTrace}
                      onKeyDown={handleRowKeyDown}
                      style={rowStyle}
                    >
                      <td style={td}>
                        {run.pr_number == null ? (
                          "—"
                        ) : repoId ? (
                          <Link
                            href={`/repos/${repoId}/pulls/${run.pr_number}`}
                            className="mono"
                            style={{ color: "var(--accent)" }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            #{run.pr_number}
                          </Link>
                        ) : (
                          <span className="mono">#{run.pr_number}</span>
                        )}
                      </td>
                      <td style={td}>{run.repo ?? "—"}</td>
                      <td style={td}>{run.agent ?? "—"}</td>
                      <td style={td}>
                        <Badge color={vMeta.color}>{verdictLabel}</Badge>
                      </td>
                      <td style={td}>{run.findings_count ?? "—"}</td>
                      <td style={td}>
                        <RunCostBadge costUsd={run.cost_usd} />
                      </td>
                      <td style={td}>{formatDuration(run.duration_s)}</td>
                      <td style={td}>
                        {run.github_url ? (
                          <span onClick={(e) => e.stopPropagation()}>
                            <MonoLink href={run.github_url}>{t("runsPage.view")}</MonoLink>
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {traceRunId && (
        <RunTraceDrawer
          runId={traceRunId}
          agentName={selectedRun?.agent ?? null}
          prNumber={selectedRun?.pr_number ?? null}
          running={false}
          onClose={() => setTraceRunId(null)}
        />
      )}
    </AppShell>
  );
}
