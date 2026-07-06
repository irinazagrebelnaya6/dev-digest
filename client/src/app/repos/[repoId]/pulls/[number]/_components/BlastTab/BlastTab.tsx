/* BlastTab — PR impact map ("what can these changes break?"). Reads the
   pre-built repo-intel index via GET /pulls/:id/blast (no LLM by default) and
   renders three levels: changed symbols → callers → affected endpoints. Each
   caller is a file:line link that opens the code at that line on GitHub (reuses
   githubBlobUrl, the FindingCard click-to-code pattern). The optional "Explain"
   button triggers the single cheap-model summary (?summary=1). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Card, SectionLabel, Markdown, MonoLink, Badge, Button, Skeleton, EmptyState, Icon } from "@devdigest/ui";
import { useBlast } from "@/lib/hooks/blast";
import { githubBlobUrl } from "@/lib/github-urls";
import { s } from "./styles";

export function BlastTab({
  prId,
  repoFullName,
  headSha,
}: {
  prId: string;
  repoFullName: string | null;
  headSha: string;
}) {
  const t = useTranslations("prReview");
  const [wantSummary, setWantSummary] = React.useState(false);
  const { data, isLoading, isFetching } = useBlast(prId, wantSummary);

  const blobHref = (file: string, line: number) =>
    repoFullName ? githubBlobUrl(repoFullName, headSha, file, line) : undefined;

  // Callers grouped by the changed symbol they reach.
  const downstreamBySymbol = new Map((data?.downstream ?? []).map((d) => [d.symbol, d]));
  const hasSymbols = (data?.changed_symbols.length ?? 0) > 0;

  const explainButton = hasSymbols && !data?.degraded && !wantSummary ? (
    <Button kind="secondary" size="sm" icon="Sparkles" onClick={() => setWantSummary(true)}>
      {t("blast.explain")}
    </Button>
  ) : null;

  return (
    <section>
      <Card>
        <SectionLabel icon="Zap" right={explainButton}>
          {t("blast.title")}
        </SectionLabel>

        {data?.degraded && (
          <div style={s.banner}>
            <Icon.AlertTriangle size={14} />
            <span>{t("blast.degraded")}</span>
          </div>
        )}

        {isLoading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Skeleton height={16} width="70%" />
            <Skeleton height={16} width="50%" />
            <Skeleton height={16} width="60%" />
          </div>
        )}

        {!isLoading && (wantSummary && isFetching) && (
          <p style={s.emptyBody}>{t("blast.summarizing")}</p>
        )}

        {!isLoading && data?.summary ? <Markdown>{data.summary}</Markdown> : null}
        {!isLoading && data?.summary ? <div style={{ height: 8 }} /> : null}

        {!isLoading && !hasSymbols && (
          <EmptyState icon="Zap" title={t("blast.emptyTitle")} body={t("blast.emptyBody")} />
        )}

        {!isLoading &&
          hasSymbols &&
          data!.changed_symbols.map((sym) => {
            const down = downstreamBySymbol.get(sym.name);
            const callers = down?.callers ?? [];
            const endpoints = down?.endpoints_affected ?? [];
            return (
              <div key={`${sym.file}:${sym.name}`} style={s.symbolBlock}>
                <div style={s.symbolHead}>
                  <span style={s.symbolName}>{sym.name}</span>
                  <Badge>{sym.kind}</Badge>
                  <MonoLink href={repoFullName ? githubBlobUrl(repoFullName, headSha, sym.file) : undefined}>
                    {sym.file}
                  </MonoLink>
                </div>

                {callers.length > 0 ? (
                  <>
                    <span style={s.rowLabel}>{t("blast.callers", { count: callers.length })}</span>
                    <div style={s.callersList}>
                      {callers.map((c, i) => (
                        <div key={i} style={s.callerRow}>
                          <span style={s.callerName}>{c.name}</span>
                          <MonoLink href={blobHref(c.file, c.line)}>
                            {c.file}:{c.line}
                          </MonoLink>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <span style={s.emptyBody}>{t("blast.noCallers")}</span>
                )}

                {endpoints.length > 0 && (
                  <>
                    <span style={s.rowLabel}>{t("blast.endpoints")}</span>
                    <div style={s.badgeRow}>
                      {endpoints.map((e) => (
                        <Badge key={e} icon="Globe">
                          {e}
                        </Badge>
                      ))}
                    </div>
                  </>
                )}
              </div>
            );
          })}

        {!isLoading && hasSymbols && (data!.reachable_endpoints.length > 0) && (
          <div style={s.symbolBlock}>
            <span style={s.rowLabel}>{t("blast.reachable")}</span>
            <div style={s.badgeRow}>
              {data!.reachable_endpoints.map((e) => (
                <Badge key={e} icon="Globe">
                  {e}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </Card>
    </section>
  );
}
