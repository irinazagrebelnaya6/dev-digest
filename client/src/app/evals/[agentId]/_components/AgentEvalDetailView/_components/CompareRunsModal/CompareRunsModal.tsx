/* CompareRunsModal — "Compare runs · vX → vY" (AC-12/AC-13/AC-14). Four
   metric-delta boxes (recall/precision/citation/cost), a system-prompt diff
   between the two agent config versions the compared batches were tagged
   with, and a "Promote" action. */
"use client";

import { useTranslations } from "next-intl";
import { Button, EVAL_METRIC_COLOR, Icon, Modal, Skeleton } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import { useCompareEvalRuns, usePromoteEvalRun } from "@/lib/hooks/evals";
import { useToast } from "@/lib/toast";
import { diffLines, diffSign, isImprovement } from "./helpers";
import { s } from "./styles";

export function CompareRunsModal({
  agent,
  batchA,
  batchB,
  onClose,
}: {
  agent: Agent;
  batchA: string;
  batchB: string;
  onClose: () => void;
}) {
  const t = useTranslations("eval");
  const toast = useToast();
  const { data, isLoading, isError } = useCompareEvalRuns(batchA, batchB);
  const promote = usePromoteEvalRun(agent.id);

  const handlePromote = async () => {
    if (!data) return;
    try {
      await promote.mutateAsync(batchB);
      toast.success(t("compare.promoted", { version: data.b.agent_version }));
      onClose();
    } catch {
      /* surfaced via the global mutationCache.onError toast */
    }
  };

  const title = data
    ? t("compare.title", { a: data.a.agent_version, b: data.b.agent_version })
    : t("compare.title", { a: "…", b: "…" });

  return (
    <Modal
      width={840}
      title={title}
      subtitle={t("compare.subtitle")}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
          <Button kind="secondary" onClick={onClose}>
            {t("compare.close")}
          </Button>
          <Button
            kind="primary"
            icon="GitBranch"
            disabled={!data || promote.isPending}
            loading={promote.isPending}
            onClick={handlePromote}
          >
            {promote.isPending
              ? t("compare.promoting")
              : t("compare.promote", { version: data?.b.agent_version ?? "" })}
          </Button>
        </div>
      }
    >
      <div style={s.body}>
        {isLoading && <Skeleton height={200} />}
        {isError && <div>{t("compare.loadError")}</div>}
        {data && (
          <>
            <div style={s.deltaRow}>
              <DeltaBox
                label={t("compare.recall")}
                oldValue={data.a.recall}
                newValue={data.b.recall}
                delta={data.delta.recall}
                metric="recall"
                color={EVAL_METRIC_COLOR.recall}
                percent
              />
              <DeltaBox
                label={t("compare.precision")}
                oldValue={data.a.precision}
                newValue={data.b.precision}
                delta={data.delta.precision}
                metric="precision"
                color={EVAL_METRIC_COLOR.precision}
                percent
              />
              <DeltaBox
                label={t("compare.citation")}
                oldValue={data.a.citation_accuracy}
                newValue={data.b.citation_accuracy}
                delta={data.delta.citation_accuracy}
                metric="citation"
                color={EVAL_METRIC_COLOR.citation_accuracy}
                percent
              />
              <DeltaBox
                label={t("compare.cost")}
                oldValue={data.a.cost_usd}
                newValue={data.b.cost_usd}
                delta={data.delta.cost_usd}
                metric="cost"
                color="var(--text-primary)"
              />
            </div>

            <div>
              <div style={s.diffHeader}>
                <span style={s.diffTitle}>
                  <Icon.FileText size={14} style={{ color: "var(--text-muted)" }} />
                  {t("compare.systemPromptDiff")}
                </span>
                <div style={s.legend}>
                  <span style={s.legendItem}>
                    <span style={s.legendSwatch("var(--code-del-text)")} />
                    {t("compare.old", { version: data.a.agent_version })}
                  </span>
                  <span style={s.legendItem}>
                    <span style={s.legendSwatch("var(--code-add-text)")} />
                    {t("compare.new", { version: data.b.agent_version })}
                  </span>
                </div>
              </div>
              <div style={s.diffBlock}>
                {diffLines(data.a.system_prompt, data.b.system_prompt).map((line, i) => (
                  <div key={i} style={s.diffLine(line.type)}>
                    {/* Leading +/- sign - same non-color signal the PR diff
                        viewer's CodeLine uses, so add/remove isn't color-only. */}
                    <span aria-hidden="true" style={s.diffSign}>
                      {diffSign(line.type)}
                    </span>
                    {line.text || " "}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function DeltaBox({
  label,
  oldValue,
  newValue,
  delta,
  metric,
  color,
  percent,
}: {
  label: string;
  oldValue: number | null;
  newValue: number | null;
  delta: number | null;
  metric: "recall" | "precision" | "citation" | "cost";
  color: string;
  percent?: boolean;
}) {
  const fmt = (v: number | null) => {
    if (v == null) return "—";
    return percent ? `${Math.round(v * 100)}%` : v.toFixed(2);
  };

  return (
    <div style={s.deltaBox}>
      <span style={s.deltaLabel}>{label}</span>
      <div style={s.deltaValueRow}>
        <span style={s.deltaOld}>{fmt(oldValue)}</span>
        <Icon.ArrowRight size={12} style={{ color: "var(--text-muted)" }} />
        <span style={s.deltaNew(color)}>{fmt(newValue)}</span>
        {delta != null && <DeltaIndicator delta={delta} metric={metric} percent={percent} />}
      </div>
    </div>
  );
}

function DeltaIndicator({
  delta,
  metric,
  percent,
}: {
  delta: number;
  metric: "recall" | "precision" | "citation" | "cost";
  percent?: boolean;
}) {
  const good = isImprovement(metric, delta);
  const flat = delta === 0;
  const DeltaIcon = flat ? Icon.Slash : delta > 0 ? Icon.ArrowUp : Icon.ArrowDown;
  const deltaColor = flat ? "var(--text-muted)" : good ? "var(--ok)" : "var(--crit)";
  const deltaText = percent ? `${Math.abs(Math.round(delta * 100))}pt` : Math.abs(delta).toFixed(2);
  return (
    <span style={s.deltaChange(deltaColor)}>
      <DeltaIcon size={12} />
      {deltaText}
    </span>
  );
}
