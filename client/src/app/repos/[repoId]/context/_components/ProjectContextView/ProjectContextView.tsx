/* ProjectContextView — read/preview-only "Project Context" screen (SPEC-01,
   Feature 1, AC-1/AC-13/AC-16/AC-18). Lists every `.md` discovered under
   specs/docs/insights in the reviewed repo's clone (path + type badge +
   "Used by N agents"), with a markdown preview of the selected doc.
   Self-fetching via `useProjectContext(repoId)` — no props besides repoId.
   Non-goals (do NOT add): upload/edit/new-folder toolbar, coverage ring,
   chunking/embedding. Zero LLM calls. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { EmptyState, ErrorState, Icon, Markdown, Skeleton } from "@devdigest/ui";
import { useProjectContext } from "@/lib/hooks/project-context";
import { s } from "./styles";

export function ProjectContextView({ repoId }: { repoId: string }) {
  const t = useTranslations("projectContext");
  const { data, isLoading, isError, refetch } = useProjectContext(repoId);
  const docs = data?.docs ?? [];
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null);

  const selected = docs.find((d) => d.path === selectedPath) ?? docs[0] ?? null;

  return (
    <div style={s.page}>
      <div style={s.header}>
        <h1 style={s.h1}>{t("title")}</h1>
        <p style={s.subtitle}>{t("subtitle")}</p>
      </div>

      {data?.degraded && (
        <div style={s.banner}>
          <Icon.AlertTriangle size={14} />
          <span>{data.reason ? t("degradedWithReason", { reason: data.reason }) : t("degraded")}</span>
        </div>
      )}

      {isLoading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Skeleton height={16} width="60%" />
          <Skeleton height={80} />
        </div>
      )}

      {isError && <ErrorState body={t("loadError")} onRetry={() => refetch()} />}

      {!isLoading && !isError && docs.length === 0 && (
        <EmptyState icon="FileText" title={t("emptyTitle")} body={t("emptyBody")} />
      )}

      {!isLoading && !isError && docs.length > 0 && (
        <div style={s.split}>
          <div style={s.listCol} role="list" aria-label={t("listLabel")}>
            {docs.map((doc) => {
              const active = selected?.path === doc.path;
              return (
                <button
                  key={doc.path}
                  type="button"
                  role="listitem"
                  onClick={() => setSelectedPath(doc.path)}
                  aria-pressed={active}
                  style={active ? { ...s.row, ...s.rowActive } : s.row}
                >
                  <div style={s.rowTop}>
                    <Icon.FileText size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                    <span style={s.path}>{doc.path}</span>
                    <span style={s.badge}>{doc.badge}</span>
                  </div>
                  <span style={s.usedBy}>
                    <Icon.Users size={12} />
                    {t("usedBy", { count: doc.used_by })}
                  </span>
                </button>
              );
            })}
          </div>

          <div style={s.detailCol}>
            {selected ? (
              <>
                <div style={s.detailHeader}>
                  <Icon.FileText size={16} style={{ color: "var(--text-muted)" }} />
                  <span style={s.detailPath}>{selected.path}</span>
                  <span style={s.badge}>{selected.badge}</span>
                  <span style={s.usedBy}>
                    <Icon.Users size={12} />
                    {t("usedBy", { count: selected.used_by })}
                  </span>
                </div>
                <div style={s.detailBody}>
                  {selected.content ? (
                    <Markdown>{selected.content}</Markdown>
                  ) : (
                    <p style={s.noPreview}>{t("noPreview")}</p>
                  )}
                </div>
              </>
            ) : (
              <p style={s.noPreview}>{t("selectPrompt")}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
