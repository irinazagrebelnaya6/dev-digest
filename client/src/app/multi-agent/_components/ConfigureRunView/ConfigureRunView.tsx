/* ConfigureRunView — Multi-Agent Review → Configure run (SPEC-06 AC-4..7).
   Step 1: pick a PR from the active repo. Step 2: while no PR is selected,
   the agent list is disabled behind a "Pick a pull request first" empty
   state; once a PR is picked, every agent renders as a checkbox row with its
   per-agent time/cost estimate (fallback markers for low/no confidence). The
   summary pre-run estimate is MAX(time)/SUM(cost) over the *selected* set,
   recomputed on every toggle. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Avatar, Button, Checkbox, EmptyState, SearchableSelect, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { useActiveRepo } from "@/lib/repo-context";
import { usePulls } from "@/lib/hooks";
import { useAgents } from "@/lib/hooks/agents";
import { useRunReview } from "@/lib/hooks/reviews";
import {
  estimateHint,
  formatEstimateCost,
  formatEstimateTime,
  summarizeSelected,
  useAgentEstimates,
} from "@/lib/hooks/multi-agent";
import { s } from "./styles";

export function ConfigureRunView() {
  const t = useTranslations("multiAgent");
  const router = useRouter();
  const { repoId } = useActiveRepo();
  const { data: pulls } = usePulls(repoId);
  const { data: agents, isLoading: agentsLoading } = useAgents();
  const [prId, setPrId] = React.useState<string>("");
  const { data: estimate } = useAgentEstimates(prId || null);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const run = useRunReview();

  const all = agents ?? [];
  const prOptions = (pulls ?? [])
    .filter((p): p is typeof p & { id: string } => p.id != null)
    .map((p) => ({ value: p.id, label: `#${p.number} · ${p.title}` }));

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const selectAll = () => setSelected(new Set(all.map((a) => a.id)));

  const estimateFor = (agentId: string) => estimate?.per_agent.find((e) => e.agent_id === agentId);
  const summary = estimate
    ? summarizeSelected(estimate.per_agent, selected)
    : { timeMs: null, costUsd: 0 };

  const handleRun = async () => {
    if (!prId || selected.size === 0) return;
    const res = await run.mutateAsync({ prId, agentIds: Array.from(selected) });
    if (res.multi_agent_run_id) router.push(`/multi-agent/${res.multi_agent_run_id}`);
  };

  return (
    <AppShell
      crumb={[
        { label: t("configure.breadcrumb"), href: "/multi-agent" },
        { label: t("configure.crumbConfigure") },
      ]}
    >
      <div style={s.page}>
        <div>
          <h1 style={s.h1}>{t("configure.title")}</h1>
          <p style={s.subtitle}>{t("configure.subtitle")}</p>
        </div>

        <section>
          <div style={s.stepHeader}>
            <span style={s.stepBadge}>1</span>
            <span style={s.stepLabel}>{t("configure.step1")}</span>
          </div>
          <SearchableSelect
            value={prId}
            onChange={setPrId}
            options={prOptions}
            placeholder={t("configure.selectPr")}
            mono={false}
          />
        </section>

        <section>
          <div style={s.stepHeader}>
            <span style={s.stepBadge}>2</span>
            <span style={s.stepLabel}>{t("configure.step2")}</span>
            {!!prId && all.length > 0 && (
              <button type="button" style={s.selectAll} onClick={selectAll}>
                {t("configure.selectAll")}
              </button>
            )}
          </div>

          {!prId ? (
            <div style={s.emptyBox}>
              <EmptyState
                icon="GitPullRequest"
                title={t("configure.emptyTitle")}
                body={t("configure.emptyBody")}
              />
            </div>
          ) : agentsLoading ? (
            <Skeleton height={200} />
          ) : all.length === 0 ? (
            <EmptyState icon="Cpu" title={t("configure.noAgents")} />
          ) : (
            <div style={s.rows}>
              {all.map((a) => {
                const est = estimateFor(a.id);
                const checked = selected.has(a.id);
                return (
                  <label key={a.id} style={s.row(checked)}>
                    <Checkbox checked={checked} onChange={() => toggle(a.id)} />
                    <Avatar name={a.name} size={28} />
                    <div style={s.rowInfo}>
                      <div style={s.rowName}>{a.name}</div>
                      {a.description && <div style={s.rowDesc}>{a.description}</div>}
                    </div>
                    <span className="mono tnum" style={s.rowHint}>
                      {estimateHint(est, true)}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </section>

        <div style={s.footer}>
          <Button
            kind="primary"
            icon="Users"
            disabled={!prId || selected.size === 0}
            loading={run.isPending}
            onClick={handleRun}
          >
            {t("configure.runButton", { count: selected.size })}
          </Button>
          {!!prId && selected.size > 0 && (
            <span className="mono" style={s.summary}>
              {t("configure.summary", {
                time: summary.timeMs != null ? formatEstimateTime(summary.timeMs) : "—",
                cost: formatEstimateCost(summary.costUsd),
              })}
            </span>
          )}
        </div>
      </div>
    </AppShell>
  );
}
