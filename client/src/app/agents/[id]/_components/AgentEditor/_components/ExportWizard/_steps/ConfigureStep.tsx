"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Card, Checkbox, FormField, SectionLabel, SelectInput } from "@devdigest/ui";
import type { CiFailOn } from "@devdigest/shared";
import type { PostAs, TriggerState } from "../types";

const TRIGGER_KEYS: (keyof TriggerState)[] = ["opened", "synchronize", "reopened"];
const POST_AS_OPTIONS: PostAs[] = ["github_review", "pr_comment", "none"];
/** `ci.json`'s `exportWizard.configure.postAs` keys are camelCase; map the
 *  snake_case `PostAs` contract values to them. */
const POST_AS_I18N_KEY: Record<PostAs, string> = {
  github_review: "githubReview",
  pr_comment: "prComment",
  none: "none",
};

const CI_FAIL_ON_VALUES: readonly CiFailOn[] = ["never", "critical", "warning", "any"];

/** Step 3 — trigger checkboxes (AC-5), "post results as" policy (AC-19), the
 *  two secret readiness rows (AC-18), and the "Fail CI on" gate selector (AC-13). */
export function ConfigureStep({
  triggers,
  onToggleTrigger,
  postAs,
  onChangePostAs,
  ciFailOn,
  onChangeCiFailOn,
  openrouterReady,
  secretsLoading,
}: {
  triggers: TriggerState;
  onToggleTrigger: (key: keyof TriggerState) => void;
  postAs: PostAs;
  onChangePostAs: (value: PostAs) => void;
  ciFailOn: CiFailOn;
  onChangeCiFailOn: (value: CiFailOn) => void;
  openrouterReady: boolean;
  secretsLoading: boolean;
}) {
  const t = useTranslations("ci");
  const tAgents = useTranslations("agents");

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <SectionLabel>{t("exportWizard.configure.secretsHeading")}</SectionLabel>
        <Card>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <span className="mono" style={{ fontSize: 13 }}>
                OPENROUTER_API_KEY
              </span>
              {secretsLoading ? (
                <Badge>{t("exportWizard.configure.secretsChecking")}</Badge>
              ) : openrouterReady ? (
                <Badge color="var(--ok)" bg="var(--bg-hover)">
                  {t("exportWizard.configure.secretsSet")}
                </Badge>
              ) : (
                <Badge color="var(--warn)" bg="var(--bg-hover)">
                  {t("exportWizard.configure.secretsNotSet")}
                </Badge>
              )}
            </div>
            {!secretsLoading && !openrouterReady && (
              <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.45 }}>
                {t("exportWizard.configure.secretsMissingHint", { key: "OPENROUTER_API_KEY" })}
              </div>
            )}

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <span className="mono" style={{ fontSize: 13 }}>
                GITHUB_TOKEN
              </span>
              <Badge color="var(--ok)" bg="var(--bg-hover)">
                {t("exportWizard.configure.secretsAutoProvided")}
              </Badge>
            </div>
          </div>
        </Card>
      </div>

      <div>
        <SectionLabel>{t("exportWizard.configure.postResultsLabel")}</SectionLabel>
        <div
          role="radiogroup"
          aria-label={t("exportWizard.configure.postResultsLabel")}
          style={{ display: "flex", flexDirection: "column", gap: 10 }}
        >
          {POST_AS_OPTIONS.map((option) => (
            <label key={option} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13.5 }}>
              <input
                type="radio"
                name="post-as"
                value={option}
                checked={postAs === option}
                onChange={() => onChangePostAs(option)}
              />
              {t(`exportWizard.configure.postAs.${POST_AS_I18N_KEY[option]}`)}
              {option === "github_review" && (
                <Badge color="var(--ok)" bg="var(--bg-hover)">
                  {t("exportWizard.recommended")}
                </Badge>
              )}
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                {t(`exportWizard.configure.postAsHint.${POST_AS_I18N_KEY[option]}`)}
              </span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <SectionLabel>{t("exportWizard.configure.triggersLabel")}</SectionLabel>
        <Card>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {TRIGGER_KEYS.map((key) => (
              <Checkbox
                key={key}
                checked={triggers[key]}
                onChange={() => onToggleTrigger(key)}
                label={t(`exportWizard.configure.triggers.${key}`)}
              />
            ))}
          </div>
        </Card>
      </div>

      <div style={{ maxWidth: 320 }}>
        <FormField label={t("exportWizard.configure.failCiOnLabel")}>
          <SelectInput
            value={ciFailOn}
            onChange={(v) => onChangeCiFailOn(v as CiFailOn)}
            options={CI_FAIL_ON_VALUES.map((v) => ({ value: v, label: tAgents(`config.ciFailOnOptions.${v}`) }))}
          />
        </FormField>
      </div>
    </div>
  );
}
