/* OnboardingTourView — the Onboarding Tour screen (SPEC-03). Reads the
   server-generated 5-section newcomer tour (architecture / critical_paths /
   run_local / reading_path / first_tasks, always in that order — AC-1/AC-4)
   and renders it as a header (file-count + staleness line + Regenerate +
   Share link), an "ON THIS PAGE" anchor nav, and 5 collapsible sections.
   Degraded/failed generation (`degraded:true`) still renders the full
   skeleton tour — never blank — plus an honest reason badge (AC-5). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Card, EmptyState, ErrorState, Icon, IconBtn, Markdown, Skeleton } from "@devdigest/ui";
import type { OnboardingSection } from "@devdigest/shared";
import { useOnboarding, useRegenerateOnboarding } from "@/lib/hooks/onboarding";
import { useActiveRepo } from "@/lib/repo-context";
import { githubBlobUrl } from "@/lib/github-urls";
import { useToast } from "@/lib/toast";
import { OnboardingDiagram } from "./OnboardingDiagram";
import { complexityForIndex, extractCommand, parseNumberedLines, stripMarkdown, type Complexity } from "./helpers";
import { s } from "./styles";

const SECTION_KINDS = ["architecture", "critical_paths", "run_local", "reading_path", "first_tasks"] as const;
type SectionKind = (typeof SECTION_KINDS)[number];

const COMPLEXITY_COLOR: Record<Complexity, { color: string; bg: string }> = {
  low: { color: "var(--ok)", bg: "var(--ok-bg)" },
  medium: { color: "var(--warn)", bg: "var(--warn-bg)" },
  high: { color: "var(--crit)", bg: "var(--crit-bg)" },
};

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function OnboardingTourView({ repoId }: { repoId: string }) {
  const t = useTranslations("onboarding");
  const { activeRepo } = useActiveRepo();
  const toast = useToast();
  const { data, isLoading, isError, refetch } = useOnboarding(repoId);
  const regenerate = useRegenerateOnboarding(repoId);
  const [linkCopied, setLinkCopied] = React.useState(false);
  const [open, setOpen] = React.useState<Record<string, boolean>>({});
  const isOpen = (kind: string) => open[kind] ?? true;
  const toggle = (kind: string) => setOpen((o) => ({ ...o, [kind]: !isOpen(kind) }));

  const repoName = activeRepo?.full_name ?? repoId;
  const repoFullName = activeRepo?.full_name ?? null;
  const defaultBranch = activeRepo?.default_branch ?? "main";

  const handleRegenerate = async () => {
    try {
      await regenerate.mutateAsync();
    } catch {
      toast.error(t("header.regenerateError"));
    }
  };

  const handleShare = () => {
    void navigator.clipboard?.writeText(window.location.href);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 1500);
  };

  const sectionsByKind = new Map<string, OnboardingSection>((data?.tour.sections ?? []).map((sec) => [sec.kind, sec]));

  return (
    <div style={s.page}>
      {isLoading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Skeleton height={28} width="40%" />
          <Skeleton height={16} width="60%" />
          <Skeleton height={160} />
          <Skeleton height={160} />
        </div>
      )}

      {isError && !isLoading && (
        <ErrorState body={t("loadError.title")} onRetry={() => refetch()} />
      )}

      {!isLoading && !isError && !data && (
        <EmptyState icon="Compass" title={t("loadError.title")} />
      )}

      {!isLoading && !isError && data && (
        <>
          <div style={s.header}>
            <div style={s.headerText}>
              <h1 style={s.h1}>{t("header.title", { repo: repoName })}</h1>
              <p style={s.subtitle}>
                {t("header.subtitle", { fileCount: data.fileCount, generatedAt: formatWhen(data.generatedAt) })}
              </p>
            </div>
            <div style={s.headerActions}>
              <Button kind="ghost" size="sm" icon="Link" onClick={handleShare}>
                {linkCopied ? t("header.linkCopied") : t("header.shareLink")}
              </Button>
              <Button
                kind="secondary"
                size="sm"
                icon="RefreshCw"
                loading={regenerate.isPending}
                disabled={regenerate.isPending}
                onClick={handleRegenerate}
              >
                {regenerate.isPending ? t("header.regenerating") : t("header.regenerate")}
              </Button>
            </div>
          </div>

          {data.degraded && (
            <div style={s.degradedBanner} role="status">
              <Icon.AlertTriangle size={14} />
              <span>{t(`degraded.${data.reason ?? "index_degraded"}`)}</span>
            </div>
          )}

          <div style={s.body}>
            <aside style={s.aside}>
              <div style={s.asideTitle}>{t("onThisPage")}</div>
              <nav style={s.asideNav} aria-label={t("onThisPage")}>
                {SECTION_KINDS.map((kind) => (
                  <a key={kind} href={`#onboarding-${kind}`} style={s.asideLink}>
                    {t(`sections.${kind}`)}
                  </a>
                ))}
              </nav>
            </aside>

            <div style={s.main}>
              {SECTION_KINDS.map((kind) => {
                const section = sectionsByKind.get(kind);
                if (!section) return null;
                return (
                  <section key={kind} id={`onboarding-${kind}`} style={s.section}>
                    <Card pad={false}>
                      <div style={s.sectionHeader} onClick={() => toggle(kind)}>
                        <Icon.ChevronDown
                          size={14}
                          style={{
                            color: "var(--text-muted)",
                            transform: isOpen(kind) ? undefined : "rotate(-90deg)",
                            transition: "transform .12s",
                          }}
                        />
                        <span style={s.sectionTitle}>{t(`sections.${kind}`)}</span>
                      </div>
                      {isOpen(kind) && (
                        <div style={s.sectionBody}>
                          <SectionContent
                            kind={kind}
                            section={section}
                            repoFullName={repoFullName}
                            defaultBranch={defaultBranch}
                            t={t}
                          />
                        </div>
                      )}
                    </Card>
                  </section>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function SectionContent({
  kind,
  section,
  repoFullName,
  defaultBranch,
  t,
}: {
  kind: SectionKind;
  section: OnboardingSection;
  repoFullName: string | null;
  defaultBranch: string;
  t: ReturnType<typeof useTranslations>;
}) {
  const blobHref = (path: string) => (repoFullName ? githubBlobUrl(repoFullName, defaultBranch, path) : undefined);

  if (kind === "architecture") {
    return (
      <>
        <Markdown>{section.body}</Markdown>
        <OnboardingDiagram diagram={section.diagram} />
      </>
    );
  }

  if (kind === "critical_paths") {
    if (section.links.length === 0) return <Markdown>{section.body}</Markdown>;
    return (
      <div>
        {section.links.map((link, i) => (
          <div key={`${link.path}-${i}`} style={i === 0 ? s.rowFirst : s.row}>
            <div style={s.rowMain}>
              <span className="mono" style={{ fontSize: 13 }}>
                {link.path}
              </span>
              {link.label !== link.path && <div style={s.rowNote}>{link.label}</div>}
            </div>
            <Button
              kind="ghost"
              size="sm"
              icon="ExternalLink"
              disabled={!repoFullName}
              onClick={() => {
                const href = blobHref(link.path);
                if (href) window.open(href, "_blank", "noopener,noreferrer");
              }}
            >
              {t("criticalPaths.open")}
            </Button>
          </div>
        ))}
      </div>
    );
  }

  if (kind === "run_local") {
    const items = parseNumberedLines(section.body);
    return (
      <div>
        {items.map((item, i) => (
          <div key={i} style={i === 0 ? s.rowFirst : s.row}>
            <span style={s.rowNum}>{i + 1}.</span>
            <div style={s.rowMain}>
              <Markdown>{item}</Markdown>
            </div>
            <IconBtn
              icon="Copy"
              label={t("copy")}
              onClick={() => void navigator.clipboard?.writeText(extractCommand(item))}
            />
          </div>
        ))}
      </div>
    );
  }

  if (kind === "reading_path") {
    if (section.links.length === 0) return <Markdown>{section.body}</Markdown>;
    return (
      <div>
        {section.links.map((link, i) => (
          <div key={`${link.path}-${i}`} style={i === 0 ? s.rowFirst : s.row}>
            <span style={s.rowNum}>{i + 1}.</span>
            <div style={s.rowMain}>
              <span className="mono" style={{ fontSize: 13 }}>
                {link.path}
              </span>
              {link.label !== link.path && <div style={s.rowNote}>{link.label}</div>}
            </div>
          </div>
        ))}
      </div>
    );
  }

  // first_tasks
  if (section.links.length === 0) return <Markdown>{section.body}</Markdown>;
  return (
    <div style={s.cardsGrid}>
      {section.links.map((link, i) => {
        const complexity = complexityForIndex(i);
        const colors = COMPLEXITY_COLOR[complexity];
        return (
          <div key={`${link.path}-${i}`} style={s.taskCard}>
            <div style={s.taskTitle}>{link.label !== link.path ? stripMarkdown(link.label) : t("firstTasks.taskFallback", { n: i + 1 })}</div>
            <div className="mono" style={s.taskPath}>
              {link.path}
            </div>
            <Badge color={colors.color} bg={colors.bg}>
              {t(`firstTasks.complexity.${complexity}`)}
            </Badge>
          </div>
        );
      })}
    </div>
  );
}
