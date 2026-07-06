/* BlastRadiusCard — Overview-tab card answering "what can these changes break?".
   Reads the pre-built repo-intel index via GET /pulls/:id/blast (no LLM by
   default): a counts summary, then a collapsible per-symbol tree — changed
   symbol → callers (file:line links that open the code at that line) →
   affected endpoints (blue) + crons (amber). Optional "Explain" button makes
   the single cheap-model summary call (?summary=1). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Card, SectionLabel, Markdown, MonoLink, Badge, Button, Skeleton, EmptyState, Icon } from "@devdigest/ui";
import { useBlast } from "@/lib/hooks/blast";
import { githubBlobUrl, githubPrUrl } from "@/lib/github-urls";
import { BlastGraph } from "./BlastGraph";
import { s } from "./styles";

const EP = { color: "#5b9bd5", bg: "rgba(91,155,213,0.14)" };
const CRON = { color: "#c9962f", bg: "rgba(201,150,47,0.14)" };

export function BlastRadiusCard({
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
  const [view, setView] = React.useState<"tree" | "graph">("tree");
  const [priorOpen, setPriorOpen] = React.useState(false);
  const { data, isLoading, isFetching } = useBlast(prId, wantSummary);

  const downstreamBySymbol = new Map((data?.downstream ?? []).map((d) => [d.symbol, d]));
  const symbols = data?.changed_symbols ?? [];
  const hasSymbols = symbols.length > 0;

  // First symbol that actually has callers starts expanded (mockup behaviour).
  const firstWithCallers = symbols.find((s0) => (downstreamBySymbol.get(s0.name)?.callers.length ?? 0) > 0);
  const [open, setOpen] = React.useState<Record<string, boolean>>({});
  const isOpen = (name: string) => open[name] ?? name === firstWithCallers?.name;
  const toggle = (name: string) => setOpen((o) => ({ ...o, [name]: !isOpen(name) }));

  // Summary counts.
  const callerCount = (data?.downstream ?? []).reduce((n, d) => n + d.callers.length, 0);
  const endpointSet = new Set<string>(data?.reachable_endpoints ?? []);
  const cronSet = new Set<string>();
  for (const d of data?.downstream ?? []) {
    for (const e of d.endpoints_affected) endpointSet.add(e);
    for (const c of d.crons_affected) cronSet.add(c);
  }

  const explainButton =
    hasSymbols && !data?.degraded && !wantSummary ? (
      <Button kind="secondary" size="sm" icon="Sparkles" onClick={() => setWantSummary(true)}>
        {t("blast.explain")}
      </Button>
    ) : null;

  const blobHref = (file: string, line?: number) =>
    repoFullName ? githubBlobUrl(repoFullName, headSha, file, line) : undefined;

  return (
    <section>
      <Card>
        <SectionLabel icon="Workflow" right={explainButton}>
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

        {!isLoading && hasSymbols && (
          <>
            <div style={s.countsRow}>
              <span style={s.count}>
                <Icon.Code size={14} />
                {t("blast.symbols", { count: symbols.length })}
              </span>
              <span style={s.count}>
                <Icon.CornerDownRight size={14} />
                {t("blast.callers", { count: callerCount })}
              </span>
              <span style={s.count}>
                <Icon.Globe size={14} />
                {t("blast.endpoints", { count: endpointSet.size })}
              </span>
              <span style={s.count}>
                <Icon.Clock size={14} />
                {t("blast.crons", { count: cronSet.size })}
              </span>

              <div style={s.toggle} role="tablist">
                {(["tree", "graph"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    role="tab"
                    aria-selected={view === v}
                    onClick={() => setView(v)}
                    style={{ ...s.toggleBtn, ...(view === v ? s.toggleBtnActive : {}) }}
                  >
                    {t(`blast.${v}`)}
                  </button>
                ))}
              </div>
            </div>

            {wantSummary && isFetching && <p style={s.emptyBody}>{t("blast.summarizing")}</p>}
            {data?.summary ? (
              <div style={s.summary}>
                <Markdown>{data.summary}</Markdown>
              </div>
            ) : null}

            {view === "tree" ? (
            <div style={s.tree}>
              {symbols.map((sym) => {
                const down = downstreamBySymbol.get(sym.name);
                const callers = down?.callers ?? [];
                const endpoints = down?.endpoints_affected ?? [];
                const crons = down?.crons_affected ?? [];
                const expandable = callers.length > 0;
                const opened = expandable && isOpen(sym.name);
                return (
                  <div key={`${sym.file}:${sym.name}`}>
                    <button
                      type="button"
                      style={s.symbolRow}
                      onClick={() => expandable && toggle(sym.name)}
                      aria-expanded={opened}
                    >
                      {expandable ? (
                        <Icon.ChevronRight
                          size={14}
                          style={{ transform: opened ? "rotate(90deg)" : "none", transition: "transform .12s", color: "var(--text-muted)" }}
                        />
                      ) : (
                        <span style={{ width: 14 }} />
                      )}
                      <Icon.Code size={13} style={{ color: "var(--text-muted)" }} />
                      <span style={s.symbolName}>{sym.name}()</span>
                      <span style={s.symbolCount}>{t("blast.callers", { count: callers.length })}</span>
                    </button>

                    {opened && (
                      <div style={s.symbolBody}>
                        {callers.map((c, i) => (
                          <div key={i} style={s.callerRow}>
                            <span style={s.arrow}>↳</span>
                            <MonoLink href={blobHref(c.file, c.line)}>
                              {c.file}:{c.line}
                            </MonoLink>
                          </div>
                        ))}
                        {(endpoints.length > 0 || crons.length > 0) && (
                          <div style={s.badgeRow}>
                            {endpoints.map((e) => (
                              <Badge key={e} icon="Globe" color={EP.color} bg={EP.bg} style={{ border: `1px solid ${EP.color}` }}>
                                {e}
                              </Badge>
                            ))}
                            {crons.map((c) => (
                              <Badge key={c} icon="Clock" color={CRON.color} bg={CRON.bg} style={{ border: `1px solid ${CRON.color}` }}>
                                {c}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            ) : (
              <BlastGraph
                downstream={data!.downstream}
                repoFullName={repoFullName}
                headSha={headSha}
                emptyLabel={t("blast.graphEmpty")}
              />
            )}

            {data!.prior_prs.length > 0 && (
              <div style={s.prior}>
                <button
                  type="button"
                  style={s.priorHead}
                  onClick={() => setPriorOpen((o) => !o)}
                  aria-expanded={priorOpen}
                >
                  <Icon.History size={14} />
                  <span>{t("blast.priorPrs")}</span>
                  <span style={s.priorCount}>
                    {data!.prior_prs.length}
                    <Icon.ChevronRight
                      size={14}
                      style={{ transform: priorOpen ? "rotate(90deg)" : "none", transition: "transform .12s" }}
                    />
                  </span>
                </button>
                {priorOpen &&
                  data!.prior_prs.map((p) => (
                    <div key={p.number} style={s.priorItem}>
                      <div style={s.priorTitle}>
                        <MonoLink href={repoFullName ? githubPrUrl(repoFullName, p.number) : undefined}>
                          #{p.number}
                        </MonoLink>
                        <span>{p.title}</span>
                      </div>
                      <span style={s.priorMeta}>
                        {p.author} · {p.overlap.join(", ")}
                      </span>
                    </div>
                  ))}
              </div>
            )}
          </>
        )}

        {!isLoading && !hasSymbols && (
          <EmptyState icon="Workflow" title={t("blast.emptyTitle")} body={t("blast.emptyBody")} />
        )}
      </Card>
    </section>
  );
}
