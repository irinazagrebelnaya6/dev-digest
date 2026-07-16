"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Card, FormField, Icon, TextInput } from "@devdigest/ui";
import type { CiTarget } from "@devdigest/shared";
import { RECOMMENDED_TARGET, TARGET_OPTIONS } from "../constants";

/** Step 1 — pick a CI target (GHA preselected + "recommended"), the target
 *  repo slug, and the base branch (AC-1, AC-15). */
export function TargetStep({
  target,
  onSelectTarget,
  repo,
  onRepoChange,
  base,
  onBaseChange,
  repoError,
}: {
  target: CiTarget;
  onSelectTarget: (target: CiTarget) => void;
  repo: string;
  onRepoChange: (value: string) => void;
  base: string;
  onBaseChange: (value: string) => void;
  repoError: string | null;
}) {
  const t = useTranslations("ci");

  return (
    <div style={{ padding: 24 }}>
      <div
        role="radiogroup"
        aria-label={t("exportWizard.target.targetsLabel")}
        style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12, marginBottom: 24 }}
      >
        {TARGET_OPTIONS.map((option) => {
          const selected = option.id === target;
          const I = Icon[option.icon];
          return (
            <Card
              key={option.id}
              hover
              style={{
                cursor: "pointer",
                border: selected ? "1px solid var(--accent)" : "1px solid var(--border)",
                background: selected ? "var(--bg-hover)" : "var(--bg-elevated)",
              }}
            >
              <button
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onSelectTarget(option.id)}
                style={{ all: "unset", cursor: "pointer", display: "flex", flexDirection: "column", gap: 8, width: "100%" }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <I size={16} />
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{t(`exportWizard.target.targets.${option.id}`)}</span>
                  </div>
                  {option.id === RECOMMENDED_TARGET && (
                    <Badge color="var(--ok)" bg="var(--bg-hover)">
                      {t("exportWizard.recommended")}
                    </Badge>
                  )}
                </div>
                <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
                  {t(`exportWizard.target.targets.${option.id}Desc`)}
                </span>
              </button>
            </Card>
          );
        })}
      </div>

      <FormField label={t("exportWizard.target.repoLabel")} hint={repoError ?? t("exportWizard.target.repoHint")} required>
        <TextInput value={repo} onChange={onRepoChange} placeholder={t("exportWizard.target.repoPlaceholder")} mono />
      </FormField>

      <FormField label={t("exportWizard.target.baseLabel")} hint={t("exportWizard.target.baseHint")}>
        <TextInput value={base} onChange={onBaseChange} mono />
      </FormField>
    </div>
  );
}
