/* ContextTab — attach repo markdown (specs/docs/insights) to this agent.
   Only PATHS are stored (`context_paths`); the reviewer reads + inlines the
   file bodies at run time (AC-5..AC-7, AC-16). This tab is the write side of
   AC-16: the "SERIALIZES AS" preview below lists paths only, never bodies.
   Styled after the sibling SkillsTab. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { EmptyState, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import { useUpdateAgent } from "@/lib/hooks/agents";
import { useRepos } from "@/lib/hooks";
import { useProjectContext } from "@/lib/hooks/project-context";
import { useToast } from "@/lib/toast";
import { s } from "./styles";

export function ContextTab({ agent }: { agent: Agent }) {
  const t = useTranslations("agents");
  const toast = useToast();
  const update = useUpdateAgent();
  const { data: repos } = useRepos();
  const [browseRepoId, setBrowseRepoId] = React.useState<string | undefined>(undefined);

  // Default the browse-picker to the first workspace repo once repos load.
  React.useEffect(() => {
    setBrowseRepoId((current) => current ?? repos?.[0]?.id);
  }, [repos]);

  const {
    data: contextData,
    isLoading: docsLoading,
    isError: docsError,
  } = useProjectContext(browseRepoId);

  const paths = agent.context_paths ?? [];

  const persist = (next: string[], successMsg: string) =>
    update.mutate(
      { id: agent.id, patch: { context_paths: next } },
      { onSuccess: () => toast.success(successMsg) },
    );

  const addPath = (path: string) => {
    if (paths.includes(path)) return;
    persist([...paths, path], t("context.added"));
  };

  const removePath = (path: string) => {
    persist(paths.filter((p) => p !== path), t("context.removed"));
  };

  const availableDocs = (contextData?.docs ?? []).filter((d) => !paths.includes(d.path));

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <div>
          <div style={s.title}>{t("context.title")}</div>
          <div style={s.hint}>{t("context.hint")}</div>
        </div>
      </div>

      {paths.length === 0 ? (
        <EmptyState icon="FileText" title={t("context.emptyTitle")} body={t("context.emptyBody")} />
      ) : (
        <ul style={s.list} aria-label={t("context.attachedListLabel")}>
          {paths.map((path) => (
            <li key={path} style={s.row}>
              <Icon.FileText size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
              <span style={s.path}>{path}</span>
              <button
                type="button"
                onClick={() => removePath(path)}
                disabled={update.isPending}
                aria-label={t("context.removeAria", { path })}
                style={s.iconBtn}
              >
                <Icon.X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div style={s.section}>
        <div style={s.sectionHeader}>
          <span style={s.subtitle}>{t("context.pickerTitle")}</span>
          {repos && repos.length > 1 && (
            <select
              value={browseRepoId ?? ""}
              onChange={(e) => setBrowseRepoId(e.target.value)}
              style={s.repoSelect}
              aria-label={t("context.repoSelectAria")}
            >
              {repos.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.full_name}
                </option>
              ))}
            </select>
          )}
        </div>

        {docsLoading && <Skeleton height={60} />}
        {docsError && <ErrorState body={t("context.pickerLoadError")} />}
        {!docsLoading && !docsError && availableDocs.length === 0 && (
          <div style={s.hint}>{t("context.noDocs")}</div>
        )}
        {!docsLoading && !docsError && availableDocs.length > 0 && (
          <ul style={s.list} aria-label={t("context.pickerListLabel")}>
            {availableDocs.map((doc) => (
              <li key={doc.path}>
                <button
                  type="button"
                  onClick={() => addPath(doc.path)}
                  disabled={update.isPending}
                  aria-label={t("context.addAria", { path: doc.path })}
                  style={s.pickerRow}
                >
                  <Icon.Plus size={13} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                  <span style={s.path}>{doc.path}</span>
                  <span style={s.badge}>{doc.badge}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div style={s.section}>
        <span style={s.subtitle}>{t("context.previewTitle")}</span>
        <pre style={s.preview}>{JSON.stringify({ context_paths: paths }, null, 2)}</pre>
      </div>
    </div>
  );
}
