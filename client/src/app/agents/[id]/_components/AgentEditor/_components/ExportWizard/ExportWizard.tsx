"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, ExportWizardSteps, Modal } from "@devdigest/ui";
import type { ApiError } from "@/lib/api";
import type { CiFailOn, CiFile, CiTarget } from "@devdigest/shared";
import { useExportCi } from "@/lib/hooks/useCi";
import { useUpdateAgent } from "@/lib/hooks/agents";
import { useSecretsStatus } from "@/lib/hooks/core";
import { DEFAULT_BASE, DEFAULT_TRIGGERS, MODAL_WIDTH, RECOMMENDED_TARGET, isValidRepoSlug } from "./constants";
import { categorizeFiles, triggersToList, validateEditedWorkflow, withEditedWorkflow } from "./helpers";
import type { InstallAction, PostAs, TriggerState, WizardStepKey } from "./types";
import { WIZARD_STEPS } from "./types";
import { TargetStep } from "./_steps/TargetStep";
import { PreviewStep } from "./_steps/PreviewStep";
import { ConfigureStep } from "./_steps/ConfigureStep";
import { InstallStep } from "./_steps/InstallStep";
import { buildZip, downloadBlob } from "./zip";

function errorMessage(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) return String((err as ApiError).message);
  return "Something went wrong.";
}

/**
 * 4-step Export-to-CI wizard: Target → Preview → Configure → Install (AC-1).
 * Reuses the shared `Modal` primitive (role="dialog"/aria-modal + close button).
 */
export function ExportWizard({
  agentId,
  agentName,
  ciFailOnDefault,
  onClose,
}: {
  agentId: string;
  agentName: string;
  ciFailOnDefault: CiFailOn;
  onClose: () => void;
}) {
  const t = useTranslations("ci");
  const exportCi = useExportCi(agentId);
  const updateAgent = useUpdateAgent();
  const secretsStatus = useSecretsStatus();

  const [step, setStep] = React.useState<WizardStepKey>("target");
  const [target, setTarget] = React.useState<CiTarget>(RECOMMENDED_TARGET);
  const [repo, setRepo] = React.useState("");
  const [base, setBase] = React.useState(DEFAULT_BASE);
  const [repoError, setRepoError] = React.useState<string | null>(null);
  const [triggers, setTriggers] = React.useState<TriggerState>(DEFAULT_TRIGGERS);
  const [postAs, setPostAs] = React.useState<PostAs>("github_review");
  const [ciFailOn, setCiFailOn] = React.useState<CiFailOn>(ciFailOnDefault);
  const [action, setAction] = React.useState<InstallAction>("open_pr");
  const [files, setFiles] = React.useState<CiFile[] | null>(null);
  const [previewError, setPreviewError] = React.useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = React.useState(false);
  const [workflowError, setWorkflowError] = React.useState<string | null>(null);
  const [prUrl, setPrUrl] = React.useState<string | null>(null);
  const [zipReady, setZipReady] = React.useState(false);
  const [installError, setInstallError] = React.useState<string | null>(null);

  // Escape-key dismiss — `Modal` provides role="dialog"/aria-modal + a close
  // button but no keyboard handler.
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const loadPreview = React.useCallback(async () => {
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const result = await exportCi.mutateAsync({
        repo: repo.trim(),
        target,
        action: "files",
        post_as: postAs,
        triggers: triggersToList(triggers),
        base,
      });
      setFiles(result.files);
    } catch (err) {
      setPreviewError(errorMessage(err));
    } finally {
      setPreviewLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, target, base]);

  const stepIndex = WIZARD_STEPS.indexOf(step);

  const goNext = () => {
    if (step === "target") {
      if (!isValidRepoSlug(repo)) {
        setRepoError(t("exportWizard.target.repoInvalid"));
        return;
      }
      setRepoError(null);
      setStep("preview");
      void loadPreview();
      return;
    }
    if (step === "preview") {
      const workflow = files ? categorizeFiles(files).workflow : null;
      const err = validateEditedWorkflow(workflow?.contents);
      if (err) {
        setWorkflowError(err);
        return;
      }
      setWorkflowError(null);
      setStep("configure");
      return;
    }
    if (step === "configure") {
      setStep("install");
      return;
    }
  };

  const goBack = () => {
    const idx = WIZARD_STEPS.indexOf(step);
    if (idx > 0) setStep(WIZARD_STEPS[idx - 1]!);
    else onClose();
  };

  const toggleTrigger = (key: keyof TriggerState) => setTriggers((prev) => ({ ...prev, [key]: !prev[key] }));

  const handleWorkflowChange = (contents: string) => {
    setFiles((prev) => {
      if (!prev) return prev;
      const { workflow } = categorizeFiles(prev);
      if (!workflow) return prev;
      return withEditedWorkflow(prev, workflow.path, contents);
    });
  };

  const handleInstall = async () => {
    setInstallError(null);
    if (action === "files") {
      if (!files) return;
      const blob = buildZip(files.map((f) => ({ path: f.path, contents: f.contents })));
      downloadBlob(blob, `devdigest-ci-${target}.zip`);
      setZipReady(true);
      return;
    }
    try {
      // `CiExportInput` carries no `ci_fail_on` field — the manifest generator
      // reads the gate policy off the agent itself (AC-13). If the maintainer
      // changed it in Configure, persist it first so the freshly-generated
      // manifest picks it up.
      if (ciFailOn !== ciFailOnDefault) {
        await updateAgent.mutateAsync({ id: agentId, patch: { ci_fail_on: ciFailOn } });
      }
      const result = await exportCi.mutateAsync({
        repo: repo.trim(),
        target,
        action: "open_pr",
        post_as: postAs,
        triggers: triggersToList(triggers),
        base,
      });
      setPrUrl(result.pr_url);
    } catch (err) {
      setInstallError(errorMessage(err));
    }
  };

  return (
    <Modal
      width={MODAL_WIDTH}
      title={t("exportWizard.title")}
      subtitle={t("exportWizard.subtitle", { agentName: agentName || t("exportWizard.thisAgent") })}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <Button kind="ghost" onClick={goBack}>
            {t("exportWizard.back")}
          </Button>
          {step !== "install" && (
            <Button kind="primary" onClick={goNext} disabled={step === "target" && !repo.trim()}>
              {t("exportWizard.next")}
            </Button>
          )}
        </div>
      }
    >
      <div style={{ padding: "16px 24px 0" }}>
        <ExportWizardSteps step={stepIndex} labels={WIZARD_STEPS.map((key) => t(`exportWizard.steps.${key}`))} />
      </div>

      {step === "target" && (
        <TargetStep
          target={target}
          onSelectTarget={setTarget}
          repo={repo}
          onRepoChange={(v) => {
            setRepo(v);
            setRepoError(null);
          }}
          base={base}
          onBaseChange={setBase}
          repoError={repoError}
        />
      )}
      {step === "preview" && (
        <>
          <PreviewStep loading={previewLoading} error={previewError} files={files} onWorkflowChange={handleWorkflowChange} />
          {workflowError && (
            <div role="alert" style={{ padding: "0 24px 16px", fontSize: 12.5, color: "var(--crit)" }}>
              {workflowError}
            </div>
          )}
        </>
      )}
      {step === "configure" && (
        <ConfigureStep
          triggers={triggers}
          onToggleTrigger={toggleTrigger}
          postAs={postAs}
          onChangePostAs={setPostAs}
          ciFailOn={ciFailOn}
          onChangeCiFailOn={setCiFailOn}
          openrouterReady={!!secretsStatus.data?.openrouter}
          secretsLoading={secretsStatus.isLoading}
        />
      )}
      {step === "install" && (
        <InstallStep
          action={action}
          onChangeAction={setAction}
          base={base}
          files={files ?? []}
          isInstalling={exportCi.isPending || updateAgent.isPending}
          prUrl={prUrl}
          zipReady={zipReady}
          error={installError}
          onInstall={handleInstall}
          onDownloadZip={() => {
            if (!files) return;
            const blob = buildZip(files.map((f) => ({ path: f.path, contents: f.contents })));
            downloadBlob(blob, `devdigest-ci-${target}.zip`);
          }}
        />
      )}
    </Modal>
  );
}
