"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Card, ErrorState, FormField, SectionLabel, Skeleton, Textarea } from "@devdigest/ui";
import type { CiFile } from "@devdigest/shared";
import { categorizeFiles } from "../helpers";

/** Step 2 — lists the generated artifact categories (AC-2); the workflow file
 *  is the only editable one (AC-2, AC-4), read live-edited into the wizard's
 *  state so the change flows through Configure into Install. */
export function PreviewStep({
  loading,
  error,
  files,
  onWorkflowChange,
}: {
  loading: boolean;
  error: string | null;
  files: CiFile[] | null;
  onWorkflowChange: (contents: string) => void;
}) {
  const t = useTranslations("ci");

  if (loading) {
    return (
      <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 12 }}>
        <Skeleton height={20} />
        <Skeleton height={20} />
        <Skeleton height={80} />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 24 }}>
        <ErrorState title={t("exportWizard.preview.loadError")} body={error} />
      </div>
    );
  }

  if (!files) return null;

  const { manifest, skills, memory, workflow } = categorizeFiles(files);

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
      <SectionLabel>{t("exportWizard.preview.heading")}</SectionLabel>

      <Card>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
          {t("exportWizard.preview.manifestTitle")}
          <Badge style={{ marginLeft: 8 }}>{t("exportWizard.preview.readOnly")}</Badge>
        </div>
        <div className="mono" style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
          {manifest?.path ?? "—"}
        </div>
      </Card>

      <Card>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
          {t("exportWizard.preview.skillsTitle", { count: skills.length })}
        </div>
        {skills.length === 0 ? (
          <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>{t("exportWizard.preview.noSkills")}</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {skills.map((skill) => (
              <div key={skill.path} className="mono" style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
                {skill.path}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{t("exportWizard.preview.memoryTitle")}</div>
        <div className="mono" style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
          {memory?.path ?? "—"}
        </div>
      </Card>

      {workflow && (
        <FormField
          label={
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {workflow.path}
              <Badge color="var(--accent)" bg="var(--bg-hover)">
                {t("exportWizard.preview.editable")}
              </Badge>
            </span>
          }
          hint={t("exportWizard.preview.workflowHint")}
        >
          <Textarea value={workflow.contents} onChange={onWorkflowChange} rows={12} mono />
        </FormField>
      )}
    </div>
  );
}
