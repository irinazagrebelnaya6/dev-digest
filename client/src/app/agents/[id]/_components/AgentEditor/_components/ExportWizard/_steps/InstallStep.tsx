"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Card, MonoLink, SectionLabel } from "@devdigest/ui";
import type { CiFile } from "@devdigest/shared";
import { estimateBundleSize, formatBytes } from "../helpers";
import type { InstallAction } from "../types";

/** Step 4 — choose the delivery action (AC-7/AC-8), preview the PR or the zip
 *  bundle, install, and surface success/error. */
export function InstallStep({
  action,
  onChangeAction,
  base,
  files,
  isInstalling,
  prUrl,
  zipReady,
  error,
  onInstall,
  onDownloadZip,
}: {
  action: InstallAction;
  onChangeAction: (action: InstallAction) => void;
  base: string;
  files: CiFile[];
  isInstalling: boolean;
  prUrl: string | null;
  zipReady: boolean;
  error: string | null;
  onInstall: () => void;
  onDownloadZip: () => void;
}) {
  const t = useTranslations("ci");
  const done = action === "open_pr" ? !!prUrl : zipReady;

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <SectionLabel>{t("exportWizard.install.actionLabel")}</SectionLabel>
        <div role="radiogroup" aria-label={t("exportWizard.install.actionLabel")} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 13.5 }}>
            <input
              type="radio"
              name="install-action"
              checked={action === "open_pr"}
              onChange={() => onChangeAction("open_pr")}
            />
            <span>
              <div style={{ fontWeight: 600 }}>{t("exportWizard.install.actions.openPr")}</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("exportWizard.install.openPrDesc")}</div>
            </span>
          </label>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 13.5 }}>
            <input
              type="radio"
              name="install-action"
              checked={action === "files"}
              onChange={() => onChangeAction("files")}
            />
            <span>
              <div style={{ fontWeight: 600 }}>{t("exportWizard.install.actions.zip")}</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("exportWizard.install.zipDesc")}</div>
            </span>
          </label>
        </div>
      </div>

      {action === "open_pr" ? (
        <Card>
          <SectionLabel>{t("exportWizard.install.prPreviewTitle")}</SectionLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
            <div>
              <strong>{t("exportWizard.install.prTitleLabel")}:</strong> {t("exportWizard.install.prTitleValue")}
            </div>
            <div className="mono">
              <strong style={{ fontFamily: "inherit" }}>{t("exportWizard.install.branchLabel")}:</strong> devdigest/ci
            </div>
            <div className="mono">
              <strong style={{ fontFamily: "inherit" }}>{t("exportWizard.install.baseLabel")}:</strong> {base}
            </div>
          </div>
        </Card>
      ) : (
        <Card>
          <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            {t("exportWizard.install.zipFileCount", { count: files.length })}
            {" · "}
            {t("exportWizard.install.zipSizeEstimate", { size: formatBytes(estimateBundleSize(files)) })}
          </div>
        </Card>
      )}

      {done ? (
        <Card>
          {action === "open_pr" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>{t("exportWizard.install.prOpenedTitle")}</div>
              {prUrl && <MonoLink href={prUrl}>{t("exportWizard.install.viewPr")}</MonoLink>}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>{t("exportWizard.install.zipReadyTitle")}</div>
              <Button kind="secondary" icon="Copy" onClick={onDownloadZip}>
                {t("exportWizard.install.downloadZip")}
              </Button>
            </div>
          )}
        </Card>
      ) : (
        <Button kind="primary" icon="GitPullRequest" onClick={onInstall} disabled={isInstalling} loading={isInstalling}>
          {isInstalling ? t("exportWizard.install.installing") : t("exportWizard.install.install")}
        </Button>
      )}

      {error && (
        <div role="alert" style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 12.5, color: "var(--crit)" }}>{error}</span>
          <Button kind="secondary" size="sm" onClick={onInstall}>
            {t("exportWizard.install.retry")}
          </Button>
        </div>
      )}
    </div>
  );
}
