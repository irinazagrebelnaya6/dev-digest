/* IntentCard — shows why a PR was opened (cheap flash-model classification):
   summary quote + in/out-of-scope columns + a Recompute button. Owns its own
   query (GET /pulls/:id/intent) and mutation (POST /pulls/:id/intent). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Card, SectionLabel, Markdown, Icon, Button, Skeleton } from "@devdigest/ui";
import { useIntent, useComputeIntent } from "@/lib/hooks/intent";
import { FEATURE_MODELS } from "@/lib/feature-models";
import { s } from "./styles";

const INTENT_MODEL = FEATURE_MODELS.find((f) => f.id === "review_intent")?.defaultModel ?? null;
/** "deepseek/deepseek-v4-flash" → "deepseek-v4-flash" (drop the provider prefix). */
const MODEL_BADGE_LABEL = INTENT_MODEL?.split("/").pop() ?? INTENT_MODEL;

export function IntentCard({ prId }: { prId: string }) {
  const t = useTranslations("prReview");
  const { data: intent, isLoading } = useIntent(prId);
  const compute = useComputeIntent(prId);

  const handleRecompute = async () => {
    try {
      await compute.mutateAsync();
    } catch {
      /* surfaced via the global mutationCache.onError toast */
    }
  };

  const recomputeButton = (
    <Button kind="secondary" size="sm" icon="RefreshCw" loading={compute.isPending} onClick={handleRecompute}>
      {compute.isPending ? t("intent.recomputing") : t("intent.recompute")}
    </Button>
  );

  return (
    <section>
      <Card>
        <SectionLabel icon="Target" right={recomputeButton}>
          {t("intent.title")}
        </SectionLabel>

        {isLoading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Skeleton height={16} width="80%" />
            <Skeleton height={16} width="60%" />
          </div>
        )}

        {!isLoading && !intent && <p style={s.emptyBody}>{t("intent.empty")}</p>}

        {!isLoading && intent && (
          <>
            <blockquote style={s.summary}>
              <Markdown>{intent.intent}</Markdown>
            </blockquote>

            <div style={s.columns}>
              <div>
                <div style={s.columnHeading("var(--ok)")}>
                  <Icon.CheckCircle size={14} />
                  {t("intent.inScope")}
                </div>
                <ul style={s.list}>
                  {intent.in_scope.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              </div>
              <div>
                <div style={s.columnHeading("var(--text-muted)")}>
                  <Icon.X size={14} />
                  {t("intent.outOfScope")}
                </div>
                <ul style={s.list}>
                  {intent.out_of_scope.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>

            {MODEL_BADGE_LABEL && (
              <div style={s.footer}>
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  {t("intent.modelBadge", { model: MODEL_BADGE_LABEL })}
                </span>
              </div>
            )}
          </>
        )}
      </Card>
    </section>
  );
}
