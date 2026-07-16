/* CiTab — Continuous Integration tab for the Agent Editor (SPEC-06).
   Lists installations for this agent (Repository · Platform · Status · Last
   run) with a "Fail CI on" gate selector per row (AC-13), an "+ Add
   repository" action that opens the Export Wizard (AC-1, AC-10), and an
   empty state when the agent isn't deployed to CI yet.

   "Fail CI on" is an agent-level field (`Agent.ci_fail_on`), not a column on
   `ci_installations` — every row shows the same current value; changing it
   from any row persists the new value on the agent AND re-exports (opens a
   fresh `devdigest/ci` PR) for that specific installation (AC-13), via
   `useUpdateCiFailOn`. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, EmptyState, ErrorState, SelectInput, Skeleton } from "@devdigest/ui";
import type { Agent, CiFailOn, CiInstallation } from "@devdigest/shared";
import { useAgentCiInstallations, useAgentCiRuns, useUpdateCiFailOn, type CiRunRecord } from "@/lib/hooks/useCi";
import { ExportWizard } from "../ExportWizard";

const CI_FAIL_ON_VALUES: readonly CiFailOn[] = ["never", "critical", "warning", "any"];

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

function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
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

export function CiTab({ agent }: { agent: Agent }) {
  const t = useTranslations("ci");
  const [wizardOpen, setWizardOpen] = React.useState(false);

  const {
    data: installations,
    isLoading: installationsLoading,
    isError: installationsError,
    refetch,
  } = useAgentCiInstallations(agent.id);
  const { data: runs } = useAgentCiRuns(agent.id);

  const hasInstallations = (installations?.length ?? 0) > 0;

  return (
    <div style={{ padding: 28, maxWidth: 920, display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700 }}>{t("tab.heading")}</h2>
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 2 }}>{t("tab.subtitle")}</p>
        </div>
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

      {wizardOpen && (
        <ExportWizard
          agentId={agent.id}
          agentName={agent.name}
          ciFailOnDefault={agent.ci_fail_on}
          onClose={() => setWizardOpen(false)}
        />
      )}
    </div>
  );
}
