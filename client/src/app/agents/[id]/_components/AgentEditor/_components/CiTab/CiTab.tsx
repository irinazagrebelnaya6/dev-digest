/* CiTab — Continuous Integration tab for the Agent Editor (SPEC-06).
   Lists installations for this agent (Repository · Platform · Status ·
   Version · Last run) with a "Fail CI on" gate selector per row (AC-13), an
   "+ Add repository" action that opens the Export Wizard (AC-1, AC-10), a
   "Refresh from CI" action that ingests completed GitHub Actions runs
   on-demand (D3), a CI run-history table below it (ALL runs, newest first),
   and an empty state when the agent isn't deployed to CI yet.

   "Fail CI on" is an agent-level field (`Agent.ci_fail_on`), not a column on
   `ci_installations` — every row shows the same current value; changing it
   from any row persists the new value on the agent AND re-exports (opens a
   fresh `devdigest/ci` PR) for that specific installation (AC-13), via
   `useUpdateCiFailOn`. */
"use client";

import React from "react";
import type { CSSProperties, KeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, EmptyState, ErrorState, MonoLink, SelectInput, Skeleton } from "@devdigest/ui";
import type { Agent, CiFailOn, CiInstallation } from "@devdigest/shared";
import { RunCostBadge } from "@/components/RunCostBadge";
import { RunTraceDrawer } from "@/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer";
import { useAgentCiInstallations, useAgentCiRuns, useIngestCiRuns, useUpdateCiFailOn, type CiRunRecord } from "@/lib/hooks/useCi";
import { ExportWizard } from "../ExportWizard";

const CI_FAIL_ON_VALUES: readonly CiFailOn[] = ["never", "critical", "warning", "any"];

/**
 * D6 — workflow version is a client constant (no `CiRun`/`CiResultArtifact`
 * contract field, no DB column). Bump this when the generated GitHub Actions
 * workflow's shape changes (`ExportWizard`'s `workflow.ts` template).
 */
const CI_WORKFLOW_VERSION = "v1";

const RUN_STATUS_COLOR: Record<string, string> = {
  succeeded: "var(--ok)",
  failed: "var(--crit)",
  running: "var(--accent)",
  no_findings: "var(--text-muted)",
};

function latestRun(runs: CiRunRecord[] | undefined, installationId: string): CiRunRecord | undefined {
  return (runs ?? [])
    .filter((r) => r.ci_installation_id === installationId)
    .sort((a, b) => ((a.ran_at ?? "") < (b.ran_at ?? "") ? 1 : -1))[0];
}

/** Newest-first ordering for the run-history table — same comparator as
 *  `latestRun`, just unfiltered (every installation's runs together). */
function sortRunsNewestFirst(runs: CiRunRecord[] | undefined): CiRunRecord[] {
  return [...(runs ?? [])].sort((a, b) => ((a.ran_at ?? "") < (b.ran_at ?? "") ? 1 : -1));
}

function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/** `duration_s` -> "12s" / "1m 23s". Null/undefined -> em dash. Local copy of
 *  the CiRunsPage helper (Track B) — kept colocated rather than a cross-route
 *  import per this track's scope (edits confined to the CiTab folder). */
function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

interface VerdictMeta {
  labelKey: "requestChanges" | "comment" | "approve" | null;
  color: string;
}

/**
 * UI-derived verdict (D4) from `ci_run.status` — same derivation as the
 * `/ci` page's `verdictMeta` (Track B). Reuses that feature's i18n keys
 * (`runsPage.verdict.*`, same `ci` namespace) instead of duplicating the
 * strings; only the pure mapping function is a local copy, never color alone
 * (always paired with the translated label text).
 */
function verdictMeta(status: string | null | undefined): VerdictMeta {
  switch (status) {
    case "failed":
      return { labelKey: "requestChanges", color: "var(--crit)" };
    case "succeeded":
      return { labelKey: "comment", color: "var(--warn)" };
    case "no_findings":
      return { labelKey: "approve", color: "var(--ok)" };
    default:
      return { labelKey: null, color: "var(--text-muted)" };
  }
}

function InstallationRow({
  agent,
  installation,
  run,
}: {
  agent: Agent;
  installation: CiInstallation;
  run: CiRunRecord | undefined;
}) {
  const t = useTranslations("ci");
  const tAgents = useTranslations("agents");
  const updateFailOn = useUpdateCiFailOn(agent.id, installation);

  const statusLabel = run?.status ? t(`tab.status.${statusKey(run.status)}`) : t("tab.status.neverRun");

  return (
    <tr>
      <td style={td}>
        <span className="mono">{installation.repo}</span>
      </td>
      <td style={td}>
        <Badge mono>{t(`exportWizard.target.targets.${installation.target_type}`)}</Badge>
      </td>
      <td style={td}>
        <Badge color={run?.status ? (RUN_STATUS_COLOR[run.status] ?? "var(--text-muted)") : "var(--text-muted)"}>
          {statusLabel}
        </Badge>
      </td>
      <td style={td}>
        <Badge mono>{CI_WORKFLOW_VERSION}</Badge>
      </td>
      <td style={td}>{formatTimestamp(run?.ran_at)}</td>
      <td style={td}>
        <SelectInput
          value={agent.ci_fail_on}
          onChange={(v) => updateFailOn.mutate(v as CiFailOn)}
          options={CI_FAIL_ON_VALUES.map((v) => ({ value: v, label: tAgents(`config.ciFailOnOptions.${v}`) }))}
        />
      </td>
    </tr>
  );
}

function statusKey(status: string): "succeeded" | "failed" | "running" | "noFindings" | "neverRun" {
  switch (status) {
    case "succeeded":
      return "succeeded";
    case "failed":
      return "failed";
    case "running":
      return "running";
    case "no_findings":
      return "noFindings";
    default:
      return "neverRun";
  }
}

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 12px",
  fontSize: 11,
  fontWeight: 600,
  color: "var(--text-muted)",
  borderBottom: "1px solid var(--border)",
  whiteSpace: "nowrap",
};

const td: React.CSSProperties = {
  padding: "10px 12px",
  fontSize: 13,
  color: "var(--text-secondary)",
  borderBottom: "1px solid var(--border)",
};

const runRowStyle: CSSProperties = {
  cursor: "pointer",
};

export function CiTab({ agent }: { agent: Agent }) {
  const t = useTranslations("ci");
  const [wizardOpen, setWizardOpen] = React.useState(false);
  const [traceRunId, setTraceRunId] = React.useState<string | null>(null);

  const {
    data: installations,
    isLoading: installationsLoading,
    isError: installationsError,
    refetch,
  } = useAgentCiInstallations(agent.id);
  const {
    data: runs,
    isLoading: runsLoading,
    isError: runsError,
    refetch: refetchRuns,
  } = useAgentCiRuns(agent.id);
  const ingestCi = useIngestCiRuns(agent.id);

  const hasInstallations = (installations?.length ?? 0) > 0;
  const sortedRuns = sortRunsNewestFirst(runs);
  const hasRuns = sortedRuns.length > 0;

  // Repo/installation label for the run-history table — `useAgentCiRuns` rows
  // don't carry `repo` themselves (that's only joined on the workspace-wide
  // `/ci/runs` query, Track B), so resolve it from this agent's own
  // installations list (already fetched above) by `ci_installation_id`.
  const installationById = React.useMemo(() => {
    const map = new Map<string, CiInstallation>();
    for (const installation of installations ?? []) map.set(installation.id, installation);
    return map;
  }, [installations]);

  const selectedRun = sortedRuns.find((r) => r.id === traceRunId) ?? null;

  const handleRefresh = async () => {
    try {
      await ingestCi.mutateAsync();
    } catch {
      /* surfaced via the global mutationCache.onError toast */
    }
  };

  return (
    <div style={{ padding: 28, maxWidth: 920, display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700 }}>{t("tab.heading")}</h2>
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 2 }}>{t("tab.subtitle")}</p>
        </div>
        <Button
          kind="secondary"
          size="sm"
          icon="RefreshCw"
          onClick={() => void handleRefresh()}
          disabled={ingestCi.isPending}
        >
          {ingestCi.isPending ? t("tab.refreshing") : t("tab.refreshFromCi")}
        </Button>
        <Button kind="primary" size="sm" icon="Plus" onClick={() => setWizardOpen(true)}>
          {t("tab.addRepository")}
        </Button>
      </div>

      {installationsLoading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Skeleton height={40} />
          <Skeleton height={40} />
        </div>
      )}

      {installationsError && <ErrorState body={t("tab.loadError")} onRetry={() => refetch()} />}

      {!installationsLoading && !installationsError && !hasInstallations && (
        <EmptyState
          icon="Workflow"
          title={t("tab.empty")}
          body={t("tab.emptyBody")}
          cta={t("tab.addRepository")}
          onCta={() => setWizardOpen(true)}
        />
      )}

      {!installationsLoading && !installationsError && hasInstallations && (
        <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <caption style={{ position: "absolute", width: 1, height: 1, overflow: "hidden" }}>{t("tab.heading")}</caption>
            <thead>
              <tr>
                <th scope="col" style={th}>
                  {t("tab.table.repository")}
                </th>
                <th scope="col" style={th}>
                  {t("tab.table.platform")}
                </th>
                <th scope="col" style={th}>
                  {t("tab.table.status")}
                </th>
                <th scope="col" style={th}>
                  {t("tab.table.version")}
                </th>
                <th scope="col" style={th}>
                  {t("tab.table.lastRun")}
                </th>
                <th scope="col" style={th}>
                  {t("tab.table.failCiOn")}
                </th>
              </tr>
            </thead>
            <tbody>
              {(installations ?? []).map((installation) => (
                <InstallationRow
                  key={installation.id}
                  agent={agent}
                  installation={installation}
                  run={latestRun(runs, installation.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div>
        <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{t("tab.runHistory.heading")}</h3>
        <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>
          {t("tab.runHistory.subtitle")}
        </p>

        {runsLoading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Skeleton height={40} />
            <Skeleton height={40} />
          </div>
        )}

        {runsError && <ErrorState body={t("tab.runHistory.loadError")} onRetry={() => refetchRuns()} />}

        {!runsLoading && !runsError && !hasRuns && (
          <EmptyState icon="Workflow" title={t("tab.runHistory.empty")} body={t("tab.runHistory.emptyBody")} />
        )}

        {!runsLoading && !runsError && hasRuns && (
          <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <caption style={{ position: "absolute", width: 1, height: 1, overflow: "hidden" }}>
                {t("tab.runHistory.heading")}
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
                    {t("tab.table.lastRun")}
                  </th>
                  <th scope="col" style={th}>
                    {t("runsPage.table.job")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedRuns.map((run) => {
                  const vMeta = verdictMeta(run.status);
                  const verdictLabel = vMeta.labelKey ? t(`runsPage.verdict.${vMeta.labelKey}`) : "—";
                  const repoLabel = installationById.get(run.ci_installation_id ?? "")?.repo ?? "—";

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
                      style={runRowStyle}
                    >
                      <td style={td}>{run.pr_number == null ? "—" : <span className="mono">#{run.pr_number}</span>}</td>
                      <td style={td}>
                        <span className="mono">{repoLabel}</span>
                      </td>
                      <td style={td}>
                        <Badge color={vMeta.color}>{verdictLabel}</Badge>
                      </td>
                      <td style={td}>{run.findings_count ?? "—"}</td>
                      <td style={td}>
                        <RunCostBadge costUsd={run.cost_usd} />
                      </td>
                      <td style={td}>{formatDuration(run.duration_s)}</td>
                      <td style={td}>{formatTimestamp(run.ran_at)}</td>
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

      {wizardOpen && (
        <ExportWizard
          agentId={agent.id}
          agentName={agent.name}
          ciFailOnDefault={agent.ci_fail_on}
          onClose={() => setWizardOpen(false)}
        />
      )}

      {traceRunId && (
        <RunTraceDrawer
          runId={traceRunId}
          agentName={agent.name}
          prNumber={selectedRun?.pr_number ?? null}
          running={false}
          onClose={() => setTraceRunId(null)}
        />
      )}
    </div>
  );
}
