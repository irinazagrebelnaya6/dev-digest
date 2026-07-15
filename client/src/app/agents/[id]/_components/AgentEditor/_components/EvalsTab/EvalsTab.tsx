/* EvalsTab — Agent Editor "Evals" tab (SPEC-05, AC-19/AC-20). Summary metric
   cards (linking out to the full per-agent dashboard), a case list (pass/fail
   via icon+text — never color alone, mirroring PrBriefCard's risk_level
   convention), expected-vs-got, severity/category tags, and run/edit/delete
   actions per case. The case editor opens as a modal (AC-20). */
"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  Badge,
  Button,
  CategoryTag,
  EmptyState,
  ErrorState,
  EVAL_METRIC_COLOR,
  Icon,
  IconBtn,
  MetricCard,
  SectionLabel,
  SeverityBadge,
  Skeleton,
  type Category,
  type Severity,
} from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import {
  useAgentEvalCases,
  useAgentEvalDashboard,
  useAgentEvalRuns,
  useDeleteEvalCase,
  useRunAgentEvalCases,
  useRunEvalCase,
  pctOrDash,
  type EvalCaseRecord,
  type EvalRunRecord,
} from "@/lib/hooks/evals";
import { useToast } from "@/lib/toast";
import { EvalCaseEditor } from "./_components/EvalCaseEditor";
import { caseRunState, latestRunByCase, lineRangeLabel, matchingFindingsCount, passingCount } from "./helpers";
import { s } from "./styles";

const SEVERITIES = new Set(["CRITICAL", "WARNING", "SUGGESTION", "INFO"]);
const CATEGORIES = new Set(["bug", "security", "perf", "style", "test"]);

type ModalState = null | "new" | { id: string };

export function EvalsTab({ agent }: { agent: Agent }) {
  const t = useTranslations("eval");
  const toast = useToast();
  const { data: cases, isLoading, isError, refetch } = useAgentEvalCases(agent.id);
  const { data: runs } = useAgentEvalRuns(agent.id);
  const { data: dashboard } = useAgentEvalDashboard(agent.id);
  const runAll = useRunAgentEvalCases(agent.id);
  const runOne = useRunEvalCase(agent.id);
  const deleteCase = useDeleteEvalCase();

  const [modal, setModal] = React.useState<ModalState>(null);
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<string | null>(null);
  const [runningCaseId, setRunningCaseId] = React.useState<string | null>(null);

  const runsByCase = React.useMemo(() => latestRunByCase(runs), [runs]);
  const passed = React.useMemo(() => passingCount(cases ?? [], runsByCase), [cases, runsByCase]);
  const total = cases?.length ?? 0;

  const handleRunAll = async () => {
    try {
      await runAll.mutateAsync();
      toast.success(t("evalsTab.runAllCases"));
    } catch {
      /* surfaced via the global mutationCache.onError toast */
    }
  };

  const handleRunOne = async (caseId: string) => {
    setRunningCaseId(caseId);
    try {
      await runOne.mutateAsync(caseId);
    } catch {
      /* surfaced via the global mutationCache.onError toast */
    } finally {
      setRunningCaseId(null);
    }
  };

  const handleDelete = async (caseId: string) => {
    try {
      await deleteCase.mutateAsync({ id: caseId, agentId: agent.id });
    } catch {
      /* surfaced via the global mutationCache.onError toast */
    } finally {
      setConfirmDeleteId(null);
    }
  };

  return (
    <div style={s.wrap}>
      {modal && (
        <EvalCaseEditor
          agent={agent}
          caseId={modal === "new" ? undefined : modal.id}
          onClose={() => setModal(null)}
        />
      )}

      <section>
        <SectionLabel
          icon="Gauge"
          right={
            <Link href={`/evals/${agent.id}`} style={{ fontSize: 12, color: "var(--accent)" }}>
              {t("evalsTab.viewFullDashboard")}
            </Link>
          }
        >
          {t("evalsTab.metricsTitle")}
        </SectionLabel>
        {dashboard ? (
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
        ) : (
          <div style={s.metricsRow}>
            <Skeleton height={90} />
            <Skeleton height={90} />
            <Skeleton height={90} />
          </div>
        )}
      </section>

      <section>
        <div style={s.casesHeader}>
          <div style={s.casesHeaderLeft}>
            <span style={s.casesTitle}>{t("evalsTab.casesHeading")}</span>
            {total > 0 && (
              <Badge color="var(--ok)" bg="var(--ok-bg)" icon="CheckCircle">
                {t("evalsTab.passingCount", { passed, total })}
              </Badge>
            )}
          </div>
          <div style={s.casesActions}>
            <Button
              kind="secondary"
              size="sm"
              icon="Play"
              disabled={total === 0 || runAll.isPending}
              loading={runAll.isPending}
              onClick={handleRunAll}
            >
              {runAll.isPending ? t("evalsTab.runningAll") : t("evalsTab.runAllCases")}
            </Button>
            <Button kind="primary" size="sm" icon="Plus" onClick={() => setModal("new")}>
              {t("evalsTab.newCase")}
            </Button>
          </div>
        </div>

        {isLoading && (
          <div style={s.list}>
            <Skeleton height={64} />
            <Skeleton height={64} />
          </div>
        )}
        {isError && <ErrorState body="Could not load eval cases." onRetry={() => refetch()} />}
        {!isLoading && !isError && total === 0 && (
          <EmptyState icon="FlaskConical" title={t("evalsTab.emptyCases")} />
        )}

        {!isLoading && !isError && total > 0 && (
          <div style={s.list}>
            {(cases ?? []).map((c) => (
              <EvalCaseRow
                key={c.id}
                evalCase={c}
                run={runsByCase.get(c.id)}
                running={runningCaseId === c.id}
                confirmingDelete={confirmDeleteId === c.id}
                onRun={() => handleRunOne(c.id)}
                onEdit={() => setModal({ id: c.id })}
                onDeleteRequest={() => setConfirmDeleteId(c.id)}
                onDeleteCancel={() => setConfirmDeleteId(null)}
                onDeleteConfirm={() => handleDelete(c.id)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function EvalCaseRow({
  evalCase: c,
  run,
  running,
  confirmingDelete,
  onRun,
  onEdit,
  onDeleteRequest,
  onDeleteCancel,
  onDeleteConfirm,
}: {
  evalCase: EvalCaseRecord;
  run: EvalRunRecord | undefined;
  running: boolean;
  confirmingDelete: boolean;
  onRun: () => void;
  onEdit: () => void;
  onDeleteRequest: () => void;
  onDeleteCancel: () => void;
  onDeleteConfirm: () => void;
}) {
  const t = useTranslations("eval");
  const state = caseRunState(run);
  const got = matchingFindingsCount(c.expected_output, run);
  const lines = lineRangeLabel(c.expected_output);

  const stateVisual =
    state === "passed"
      ? { icon: "CheckCircle" as const, color: "var(--ok)", label: t("evalsTab.passed") }
      : state === "failed"
        ? { icon: "XCircle" as const, color: "var(--crit)", label: t("evalsTab.failed") }
        : state === "error"
          ? { icon: "AlertTriangle" as const, color: "var(--warn)", label: t("evalsTab.error") }
          : { icon: "Dot" as const, color: "var(--text-muted)", label: t("evalsTab.neverRun") };
  const StateIcon = Icon[stateVisual.icon];

  const subtitle =
    c.expected_output.type === "must_find"
      ? t("evalsTab.expectedMustFind", { file: c.expected_output.file, lines, got })
      : t("evalsTab.expectedMustNotFlag", { file: c.expected_output.file, lines, got });

  const severity = c.input_meta?.severity;
  const category = c.input_meta?.category;

  return (
    <div style={s.row}>
      <div style={s.stateIcon} title={stateVisual.label}>
        <StateIcon size={18} style={{ color: stateVisual.color }} />
      </div>
      <div style={s.info}>
        <div style={s.nameRow}>
          <span className="mono" style={s.name}>
            {c.name}
          </span>
          <span style={s.stateLabel(stateVisual.color)}>{stateVisual.label}</span>
        </div>
        <span style={s.subtitle}>{subtitle}</span>
      </div>
      <div style={s.tags}>
        {/* Not `compact` — the compact variant hides the text label, which
            would violate the "icon + text, never color alone" a11y rule. */}
        {severity && SEVERITIES.has(severity) && <SeverityBadge severity={severity as Severity} />}
        {category && CATEGORIES.has(category) && <CategoryTag category={category as Category} />}
      </div>
      {confirmingDelete ? (
        <div style={s.confirmRow}>
          <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>{t("evalsTab.confirmDelete")}</span>
          <Button kind="danger" size="sm" onClick={onDeleteConfirm}>
            {t("evalsTab.confirmDeleteYes")}
          </Button>
          <Button kind="ghost" size="sm" onClick={onDeleteCancel}>
            {t("evalsTab.confirmDeleteCancel")}
          </Button>
        </div>
      ) : (
        <div style={s.actions}>
          <IconBtn icon="Play" label={t("evalsTab.run")} onClick={onRun} active={running} />
          <IconBtn icon="Edit" label={t("evalsTab.edit")} onClick={onEdit} />
          <IconBtn icon="Trash" label={t("evalsTab.delete")} onClick={onDeleteRequest} danger />
        </div>
      )}
    </div>
  );
}
