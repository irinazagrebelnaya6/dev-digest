/* RiskAreasCard — shows an LLM-derived merge-risk assessment for a PR. Risks are
   grouped by severity into red (high) / yellow (medium) / grey (low) toggle tabs
   — one tab per severity that has any risks, showing its count. Selecting a tab
   reveals only that severity's risks: a category-icon pill plus explanation prose
   (inline `code`) and file:line references. Owns its own query
   (GET /pulls/:id/risks) and mutation (POST /pulls/:id/risks). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { Risk } from "@devdigest/shared";
import { Card, SectionLabel, Markdown, MonoLink, Badge, Button, Skeleton } from "@devdigest/ui";
import { useRisks, useComputeRisks } from "@/lib/hooks/risks";
import { FEATURE_MODELS } from "@/lib/feature-models";
import { kindIcon, severityColors, SEVERITY_ORDER, SEVERITY_LABEL_KEY } from "./helpers";
import { s } from "./styles";

type Severity = Risk["severity"];

const RISKS_MODEL = FEATURE_MODELS.find((f) => f.id === "risk_brief")?.defaultModel ?? null;
/** "openai/gpt-4.1" → "gpt-4.1" (drop the provider prefix). */
const MODEL_BADGE_LABEL = RISKS_MODEL?.split("/").pop() ?? RISKS_MODEL;

export function RiskAreasCard({ prId }: { prId: string }) {
  const t = useTranslations("prReview");
  const { data: record, isLoading } = useRisks(prId);
  const compute = useComputeRisks(prId);
  const [activeSev, setActiveSev] = React.useState<Severity | null>(null);

  const handleRecompute = async () => {
    try {
      await compute.mutateAsync();
    } catch {
      /* surfaced via the global mutationCache.onError toast */
    }
  };

  const recomputeButton = (
    <Button kind="secondary" size="sm" icon="RefreshCw" loading={compute.isPending} onClick={handleRecompute}>
      {compute.isPending ? t("riskAreas.recomputing") : t("riskAreas.recompute")}
    </Button>
  );

  const risks = record?.risks ?? [];

  // Group by severity and keep only the severities that actually have risks,
  // ordered most→least severe. The active tab defaults to the highest severity
  // present (derived, not stored, so it stays correct when the data changes).
  const bySeverity = { high: [], medium: [], low: [] } as Record<Severity, Risk[]>;
  for (const r of risks) bySeverity[r.severity]?.push(r);
  const presentSeverities = SEVERITY_ORDER.filter((sev) => bySeverity[sev].length > 0);
  const effectiveSev =
    activeSev && bySeverity[activeSev].length > 0 ? activeSev : presentSeverities[0];

  return (
    <section>
      <Card>
        <SectionLabel icon="AlertTriangle" right={recomputeButton}>
          {t("riskAreas.title")}
        </SectionLabel>

        {isLoading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Skeleton height={16} width="80%" />
            <Skeleton height={16} width="60%" />
          </div>
        )}

        {!isLoading && !record && <p style={s.emptyBody}>{t("riskAreas.empty")}</p>}

        {!isLoading && record && risks.length === 0 && (
          <p style={s.emptyBody}>{t("riskAreas.noRisks")}</p>
        )}

        {!isLoading && record && risks.length > 0 && effectiveSev && (
          <>
            <div style={s.tabRow} role="tablist">
              {presentSeverities.map((sev) => {
                const { color, bg } = severityColors(sev);
                const active = sev === effectiveSev;
                return (
                  <button
                    key={sev}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setActiveSev(sev)}
                    style={{
                      ...s.tab,
                      color,
                      borderColor: color,
                      background: active ? bg : "transparent",
                      opacity: active ? 1 : 0.6,
                      fontWeight: active ? 700 : 600,
                    }}
                  >
                    <span style={{ ...s.tabDot, background: color }} />
                    {t(SEVERITY_LABEL_KEY[sev])}
                    <span style={s.tabCount}>{bySeverity[sev].length}</span>
                  </button>
                );
              })}
            </div>

            {bySeverity[effectiveSev].map((risk, i) => {
              const { color, bg } = severityColors(risk.severity);
              return (
                <div key={i} style={s.riskBlock}>
                  <div>
                    <Badge
                      icon={kindIcon(risk.kind)}
                      color={color}
                      bg={bg}
                      style={{ border: `1px solid ${color}` }}
                    >
                      {risk.title}
                    </Badge>
                  </div>
                  <Markdown>{risk.explanation}</Markdown>
                  {risk.file_refs.length > 0 && (
                    <div style={s.refsRow}>
                      {risk.file_refs.map((ref, j) => (
                        <MonoLink key={j}>{ref}</MonoLink>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}

        {MODEL_BADGE_LABEL && (
          <div style={s.footer}>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {t("riskAreas.modelBadge", { model: MODEL_BADGE_LABEL })}
            </span>
          </div>
        )}
      </Card>
    </section>
  );
}
