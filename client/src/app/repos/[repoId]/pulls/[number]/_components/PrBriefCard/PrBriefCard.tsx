/* PrBriefCard — "Why + Risk Brief" (SPEC-04). One at-a-glance verdict composed
   server-side from already-derived signals (intent, blast, smart-diff group
   stats, best-effort linked issue, context specs): what changed + why,
   risk_level (color + text label, never color alone), risks[] each with a
   description and a link to the real file/endpoint, and an ordered
   review_focus[] "look here first" list. Coexists with RiskAreasCard — does
   NOT replace it. Owns its own query (GET /pulls/:id/brief, cached /
   generate-on-first-view) and mutation (POST /pulls/:id/brief/regenerate). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Card, SectionLabel, Markdown, MonoLink, Badge, Button, Skeleton, EmptyState, Icon } from "@devdigest/ui";
import { usePrBrief, useRegeneratePrBrief } from "@/lib/hooks/brief";
import { FEATURE_MODELS } from "@/lib/feature-models";
import { githubBlobUrl } from "@/lib/github-urls";
import { riskLevelColors, isEndpointLink, RISK_LEVEL_LABEL_KEY } from "./helpers";
import { s } from "./styles";

const BRIEF_MODEL = FEATURE_MODELS.find((f) => f.id === "risk_brief")?.defaultModel ?? null;
/** "openai/gpt-4.1" → "gpt-4.1" (drop the provider prefix). */
const MODEL_BADGE_LABEL = BRIEF_MODEL?.split("/").pop() ?? BRIEF_MODEL;

export function PrBriefCard({
  prId,
  repoFullName,
  headSha,
}: {
  prId: string;
  repoFullName?: string | null;
  headSha?: string | null;
}) {
  const t = useTranslations("prReview");
  const { data: response, isLoading, isError, refetch } = usePrBrief(prId);
  const regenerate = useRegeneratePrBrief(prId);

  const handleRegenerate = async () => {
    try {
      await regenerate.mutateAsync();
    } catch {
      /* surfaced via the global mutationCache.onError toast */
    }
  };

  /** A file link gets a real GitHub blob href; an endpoint link (e.g. "GET
   *  /path") is not a file and is rendered as plain mono text instead. */
  const linkHref = (link: string) =>
    !isEndpointLink(link) && repoFullName && headSha
      ? githubBlobUrl(repoFullName, headSha, link)
      : undefined;

  const regenerateButton = (
    <Button kind="secondary" size="sm" icon="RefreshCw" loading={regenerate.isPending} onClick={handleRegenerate}>
      {regenerate.isPending ? t("brief.regenerating") : t("brief.regenerate")}
    </Button>
  );

  const brief = response?.brief;
  const stale = !!(response?.stale || brief?.stale);

  return (
    <section>
      <Card>
        <SectionLabel icon="FileText" right={regenerateButton}>
          {t("brief.title")}
        </SectionLabel>

        {isLoading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Skeleton height={16} width="90%" />
            <Skeleton height={16} width="70%" />
            <Skeleton height={16} width="50%" />
          </div>
        )}

        {isError && !isLoading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <p style={s.emptyBody}>{t("brief.loadError")}</p>
            <Button kind="secondary" size="sm" icon="RefreshCw" onClick={() => refetch()}>
              {t("brief.retry")}
            </Button>
          </div>
        )}

        {!isLoading && !isError && !brief && (
          <EmptyState icon="FileText" title={t("brief.emptyTitle")} body={t("brief.emptyBody")} />
        )}

        {!isLoading && !isError && brief && (
          <>
            {stale && (
              <div style={s.banner} role="status">
                <Icon.Clock size={14} />
                <span>{t("brief.staleBadge")}</span>
              </div>
            )}
            {brief.degraded && (
              <div style={s.banner} role="status">
                <Icon.AlertTriangle size={14} />
                <span>{brief.reason ? t("brief.degradedReason", { reason: brief.reason }) : t("brief.degraded")}</span>
              </div>
            )}

            <p style={s.what}>{brief.what}</p>
            <div style={s.why}>
              <Markdown>{brief.why}</Markdown>
            </div>

            <div style={s.levelRow}>
              <span style={s.levelLabel}>{t("brief.riskLevel")}</span>
              {(() => {
                const { color, bg } = riskLevelColors(brief.risk_level);
                return (
                  <Badge color={color} bg={bg} dot style={{ border: `1px solid ${color}` }}>
                    {t(RISK_LEVEL_LABEL_KEY[brief.risk_level])}
                  </Badge>
                );
              })()}
            </div>

            {brief.risks.length > 0 && (
              <>
                <div style={s.sectionHeading}>{t("brief.risksHeading")}</div>
                {brief.risks.map((risk, i) => (
                  <div key={i} style={s.riskBlock}>
                    <Markdown>{risk.description}</Markdown>
                    <MonoLink href={linkHref(risk.link)}>{risk.link}</MonoLink>
                  </div>
                ))}
              </>
            )}

            {brief.review_focus.length > 0 && (
              <>
                <div style={s.sectionHeading}>{t("brief.reviewFocusHeading")}</div>
                <ol style={s.focusList}>
                  {brief.review_focus.map((focus, i) => (
                    <li key={i} style={s.focusItem}>
                      <span style={s.focusIndex}>{i + 1}.</span>
                      <span>{focus.label}</span>
                      <MonoLink href={linkHref(focus.link)}>{focus.link}</MonoLink>
                    </li>
                  ))}
                </ol>
              </>
            )}

            {MODEL_BADGE_LABEL && (
              <div style={s.footer}>
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  {t("brief.modelBadge", { model: MODEL_BADGE_LABEL })}
                </span>
              </div>
            )}
          </>
        )}
      </Card>
    </section>
  );
}
