/* RunReviewDropdown — SPEC-06 AC-1..3. "Pick agents to run" checkbox picker,
   replacing the old run-all/run-one dropdown. Launches a multi-agent review
   for exactly the checked set and navigates to its Multi-Agent Review results
   page (`multi_agent_run_id` on the response). */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Checkbox, Icon } from "@devdigest/ui";
import { useAgents } from "../../../../../../../lib/hooks/agents";
import { useRunReview } from "../../../../../../../lib/hooks/reviews";
import { useAgentEstimates, estimateHint } from "../../../../../../../lib/hooks/multi-agent";
import { s } from "./styles";

export function RunReviewDropdown({
  prId,
  size = "sm",
  kind = "primary",
  warnMerged = false,
  onRunStart,
  onRunsStarted,
  onRunSettled,
}: {
  prId: string;
  size?: "sm" | "md" | "lg";
  kind?: "primary" | "secondary";
  /** PR is already merged/closed — dim the trigger and warn, but still allow. */
  warnMerged?: boolean;
  /** Fired the moment a run is kicked off (before it completes). */
  onRunStart?: () => void;
  onRunsStarted?: (runIds: string[]) => void;
  /** Fired when the run request settles (success or error). */
  onRunSettled?: () => void;
}) {
  const t = useTranslations("prReview");
  const router = useRouter();
  const { data: agents } = useAgents();
  const { data: estimates } = useAgentEstimates(prId);
  const run = useRunReview();
  const [open, setOpen] = React.useState(false);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const initialized = React.useRef(false);
  const ref = React.useRef<HTMLDivElement>(null);

  const all = agents ?? [];

  // Default-select every enabled agent the first time the list loads, so the
  // picker isn't empty on open (mirrors the old "Run all" default).
  React.useEffect(() => {
    if (!initialized.current && all.length > 0) {
      setSelected(new Set(all.filter((a) => a.enabled).map((a) => a.id)));
      initialized.current = true;
    }
  }, [all]);

  React.useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const estimateFor = (agentId: string) => estimates?.per_agent.find((e) => e.agent_id === agentId);

  const count = selected.size;

  const kick = async () => {
    onRunStart?.();
    try {
      const res = await run.mutateAsync({ prId, agentIds: Array.from(selected) });
      onRunsStarted?.(res.runs.map((r) => r.run_id));
      setOpen(false);
      if (res.multi_agent_run_id) router.push(`/multi-agent/${res.multi_agent_run_id}`);
    } finally {
      onRunSettled?.();
    }
  };

  return (
    <div ref={ref} style={s.wrap}>
      <span
        onClick={() => setOpen((o) => !o)}
        title={warnMerged ? t("runReview.mergedTooltip") : undefined}
        style={warnMerged ? { opacity: 0.6 } : undefined}
      >
        <Button kind={kind} size={size} iconRight="ChevronDown" icon="Users" loading={run.isPending}>
          {run.isPending ? t("runReview.running") : t("runReview.runReview")}
        </Button>
      </span>
      {open && (
        <div style={s.panel}>
          <div style={s.header}>
            <span>{t("runReview.pickAgentsTitle")}</span>
            {count > 0 && (
              <button type="button" style={s.clear} onClick={() => setSelected(new Set())}>
                {t("runReview.clear")}
              </button>
            )}
          </div>

          {warnMerged && <div style={s.emptyNote}>{t("runReview.mergedWarning")}</div>}

          {all.length === 0 ? (
            <div style={s.emptyNote}>{t("runReview.noAgents")}</div>
          ) : (
            <div style={s.list}>
              {all.map((a) => (
                <div key={a.id} style={s.row}>
                  <div style={s.rowLabel}>
                    <Checkbox checked={selected.has(a.id)} onChange={() => toggle(a.id)} />
                    <span style={s.rowName}>{a.name}</span>
                  </div>
                  <span className="mono tnum" style={s.rowHint}>
                    {estimateHint(estimateFor(a.id))}
                  </span>
                </div>
              ))}
            </div>
          )}

          <Button kind="primary" full disabled={count === 0} loading={run.isPending} onClick={kick}>
            {t("runReview.runMultiAgent", { count })}
          </Button>

          <div style={s.divider} />
          <button type="button" style={s.configureLink} onClick={() => router.push("/agents")}>
            <Icon.Settings size={13} style={{ color: "var(--text-muted)" }} />
            {t("runReview.configureAgents")}
          </button>
        </div>
      )}
    </div>
  );
}
