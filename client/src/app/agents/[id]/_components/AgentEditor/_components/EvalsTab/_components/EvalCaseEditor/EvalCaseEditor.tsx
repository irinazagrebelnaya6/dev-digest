/* EvalCaseEditor — case editor modal (AC-20). Name, Diff/Files/PR-meta input
   tabs, an `EvalExpectation`-validated expected-output JSON editor (client-side
   rejection before save), a "Run case" action, and a run-on-save toggle. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Icon, Modal, Skeleton, TextInput, Textarea, Toggle } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import {
  useAgentEvalRuns,
  useCreateEvalCase,
  useEvalCase,
  useRunEvalCase,
  useUpdateEvalCase,
} from "@/lib/hooks/evals";
import { useToast } from "@/lib/toast";
import {
  expectationSkeleton,
  filesToText,
  firstFileFromDiff,
  metaOrEmpty,
  textToFiles,
  validateExpectedOutput,
} from "./helpers";
import { s } from "./styles";

type InputTab = "diff" | "files" | "prMeta";

export function EvalCaseEditor({
  agent,
  caseId,
  onClose,
}: {
  agent: Agent;
  caseId?: string;
  onClose: () => void;
}) {
  const t = useTranslations("eval");
  const toast = useToast();
  const isNew = !caseId;

  const { data: existing, isLoading } = useEvalCase(caseId);
  const { data: runs } = useAgentEvalRuns(agent.id);
  const createCase = useCreateEvalCase(agent.id);
  const updateCase = useUpdateEvalCase();
  const runCase = useRunEvalCase(agent.id);

  const [name, setName] = React.useState("");
  const [inputTab, setInputTab] = React.useState<InputTab>("diff");
  const [diff, setDiff] = React.useState("");
  const [filesText, setFilesText] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [body, setBody] = React.useState("");
  const [expectedText, setExpectedText] = React.useState(() => expectationSkeleton("must_find", ""));
  const [runOnSave, setRunOnSave] = React.useState(false);
  const [initialized, setInitialized] = React.useState(isNew);

  // Prefill once the existing case loads (id-keyed reset — mirrors ConfigTab's
  // "reset local form when switching entities" pattern).
  React.useEffect(() => {
    if (!existing || initialized) return;
    setName(existing.name);
    setDiff(existing.input_diff);
    setFilesText(filesToText(existing.input_files));
    const meta = metaOrEmpty(existing.input_meta);
    setTitle(meta.title ?? "");
    setBody(meta.body ?? "");
    setExpectedText(JSON.stringify(existing.expected_output, null, 2));
    setInitialized(true);
  }, [existing, initialized]);

  const validation = validateExpectedOutput(expectedText);

  const latestRun = React.useMemo(() => {
    if (!caseId || !runs) return undefined;
    return [...runs].filter((r) => r.case_id === caseId).sort((a, b) => (a.ran_at < b.ran_at ? 1 : -1))[0];
  }, [runs, caseId]);

  const handleInsertSkeleton = () => {
    const type = validation.valid ? validation.value.type : "must_find";
    setExpectedText(expectationSkeleton(type, firstFileFromDiff(diff)));
  };

  const handleSave = async () => {
    if (!validation.valid || !name.trim()) return;
    const payload = {
      name: name.trim(),
      input_diff: diff,
      input_files: textToFiles(filesText),
      input_meta: { title: title || undefined, body: body || undefined },
      expected_output: validation.value,
    };
    try {
      const saved = isNew
        ? await createCase.mutateAsync(payload)
        : await updateCase.mutateAsync({ id: caseId!, agentId: agent.id, patch: payload });
      toast.success(t("caseEditor.save"));
      if (runOnSave) {
        await runCase.mutateAsync(saved.id);
      }
      onClose();
    } catch {
      /* surfaced via the global mutationCache.onError toast */
    }
  };

  const handleRunCase = async () => {
    if (!caseId) return;
    try {
      await runCase.mutateAsync(caseId);
    } catch {
      /* surfaced via the global mutationCache.onError toast */
    }
  };

  const saving = createCase.isPending || updateCase.isPending;
  const canSave = !!name.trim() && validation.valid;

  return (
    <Modal
      width={920}
      title={isNew ? t("caseEditor.newCase") : t("caseEditor.caseTitle", { name })}
      subtitle={`${agent.name} · simulate a PR and assert the expected output`}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <label style={s.runOnSave}>
            <Toggle on={runOnSave} onChange={setRunOnSave} size={14} />
            {t("caseEditor.runOnSave")}
          </label>
          <div style={s.footerActions}>
            <Button kind="secondary" onClick={onClose}>
              {t("caseEditor.cancel")}
            </Button>
            <Button kind="secondary" icon="Play" disabled={isNew || runCase.isPending} loading={runCase.isPending} onClick={handleRunCase}>
              {runCase.isPending ? t("caseEditor.running") : t("caseEditor.runCase")}
            </Button>
            <Button kind="primary" icon="Check" disabled={!canSave || saving} loading={saving} onClick={handleSave}>
              {saving ? t("caseEditor.saving") : t("caseEditor.save")}
            </Button>
          </div>
        </div>
      }
    >
      {!isNew && isLoading ? (
        <div style={{ padding: 24 }}>
          <Skeleton height={200} />
        </div>
      ) : (
        <div style={s.body}>
          <div style={s.col}>
            <div>
              <div style={s.panelTitle}>{t("caseEditor.nameLabel")}</div>
              <TextInput value={name} onChange={setName} placeholder={t("caseEditor.namePlaceholder")} mono />
            </div>

            <div>
              <div style={s.panelTitle}>{t("caseEditor.inputLabel")}</div>
              <div style={s.inputTabs}>
                {(["diff", "files", "prMeta"] as InputTab[]).map((tab) => (
                  <button key={tab} style={s.inputTab(inputTab === tab)} onClick={() => setInputTab(tab)}>
                    {t(`caseEditor.tabs.${tab}`)}
                  </button>
                ))}
              </div>
              {inputTab === "diff" && (
                <Textarea value={diff} onChange={setDiff} rows={12} mono placeholder={t("caseEditor.diffPlaceholder")} />
              )}
              {inputTab === "files" && (
                <>
                  <Textarea value={filesText} onChange={setFilesText} rows={6} mono placeholder={t("caseEditor.filesPlaceholder")} />
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>{t("caseEditor.filesHint")}</div>
                </>
              )}
              {inputTab === "prMeta" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <TextInput value={title} onChange={setTitle} placeholder={t("caseEditor.titlePlaceholder")} />
                  <Textarea value={body} onChange={setBody} rows={4} placeholder={t("caseEditor.bodyPlaceholder")} />
                </div>
              )}
            </div>
          </div>

          <div style={s.col}>
            <div style={s.panelHeader}>
              <span style={s.panelTitle}>{t("caseEditor.expectedOutput")}</span>
              <Badge
                color={validation.valid ? "var(--ok)" : "var(--crit)"}
                bg={validation.valid ? "var(--ok-bg)" : "var(--crit-bg)"}
                icon={validation.valid ? "CheckCircle" : "XCircle"}
              >
                {validation.valid ? t("caseEditor.validJson") : t("caseEditor.invalidJson")}
              </Badge>
              <Button kind="ghost" size="sm" icon="Plus" onClick={handleInsertSkeleton}>
                {t("caseEditor.insertSkeleton")}
              </Button>
            </div>
            <Textarea value={expectedText} onChange={setExpectedText} rows={10} mono />

            {latestRun && (
              <div style={s.lastRun(!!latestRun.pass)}>
                <Icon.CheckCircle size={14} style={{ display: latestRun.pass ? "block" : "none" }} />
                <Icon.XCircle size={14} style={{ display: latestRun.pass ? "none" : "block" }} />
                <span>
                  {latestRun.pass ? t("caseEditor.lastRunPassed") : t("caseEditor.lastRunFailed")}
                  {" · "}
                  {t("caseEditor.resultSummary", {
                    recall: latestRun.recall != null ? Math.round(latestRun.recall * 100) : "—",
                    precision: latestRun.precision != null ? Math.round(latestRun.precision * 100) : "—",
                    citation: latestRun.citation_accuracy != null ? Math.round(latestRun.citation_accuracy * 100) : "—",
                    duration: latestRun.duration_ms != null ? (latestRun.duration_ms / 1000).toFixed(1) : "—",
                  })}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
