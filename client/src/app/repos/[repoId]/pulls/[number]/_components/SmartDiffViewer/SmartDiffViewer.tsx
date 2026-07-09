/* SmartDiffViewer — risk-ordered "Files changed" view (Smart Diff). Groups the
   PR's changed files by role (core → wiring → boilerplate, server-authoritative
   order) so the reviewer reads business logic first; boilerplate starts
   collapsed. A "N findings" badge on files with findings jumps to the first
   cited line. No LLM call — purely composes already-loaded pr_files +
   already-computed findings (see GET /pulls/:id/smart-diff). Falls back to the
   plain DiffViewer while loading, on error, or when no smart-diff data exists. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Chip } from "@devdigest/ui";
import { DiffViewer, FileCard, type DiffCommentApi } from "@/components/diff-viewer";
import { useSmartDiff } from "@/lib/hooks/smart-diff";
import type { PrFile, SmartDiffRole } from "@devdigest/shared";
import { defaultOpenForRole, findPrFile, scrollToFindingLine, sumStats } from "./helpers";
import { s } from "./styles";

type Mode = "smart" | "original";

const ROLE_LABEL_KEY: Record<SmartDiffRole, string> = {
  core: "smartDiff.coreLabel",
  wiring: "smartDiff.wiringLabel",
  boilerplate: "smartDiff.boilerplateLabel",
};

const ROLE_SUBTITLE_KEY: Record<SmartDiffRole, string> = {
  core: "smartDiff.coreSubtitle",
  wiring: "smartDiff.wiringSubtitle",
  boilerplate: "smartDiff.boilerplateSubtitle",
};

export function SmartDiffViewer({
  prId,
  files,
  commenting,
}: {
  prId: string | null;
  files: PrFile[];
  commenting?: DiffCommentApi;
}) {
  const t = useTranslations("prReview");
  const { data, isLoading, isError } = useSmartDiff(prId);
  const [mode, setMode] = React.useState<Mode>("smart");

  // Which files the user explicitly asked to expand (via the "N findings" badge) —
  // overrides the role-based default-open decision for that one file.
  const [openOverrides, setOpenOverrides] = React.useState<Record<string, boolean>>({});
  const [pendingScroll, setPendingScroll] = React.useState<{ path: string; line: number } | null>(null);

  React.useEffect(() => {
    if (!pendingScroll) return;
    scrollToFindingLine(pendingScroll.path, pendingScroll.line);
    setPendingScroll(null);
  }, [pendingScroll]);

  const handleFindingsClick = (path: string, lines: number[]) => {
    const first = lines[0];
    setOpenOverrides((prev) => ({ ...prev, [path]: true }));
    if (first != null) setPendingScroll({ path, line: first });
  };

  const fallback = <DiffViewer files={files} commenting={commenting} />;

  if (!prId || isLoading || isError || !data) return fallback;

  const { additions, deletions } = sumStats(files);
  // Group order is server-authoritative (core → wiring → boilerplate) — render
  // data.groups as received, never re-sort on the client.
  const orderedGroups = data.groups;

  return (
    <div style={s.root}>
      <div style={s.topBar}>
        <span style={s.heading}>{t("smartDiff.heading")}</span>
        <span style={s.summary}>
          {t("smartDiff.summary", { files: files.length, additions, deletions })}
        </span>
        <div style={s.toggle}>
          <Chip active={mode === "smart"} onClick={() => setMode("smart")}>
            {t("smartDiff.smartOrder")}
          </Chip>
          <Chip active={mode === "original"} onClick={() => setMode("original")}>
            {t("smartDiff.originalOrder")}
          </Chip>
        </div>
      </div>

      {mode === "original" ? (
        fallback
      ) : (
        <div style={s.groups}>
          {orderedGroups.map((group) => (
            <div key={group.role} style={s.group}>
              <div style={s.groupHeader}>
                <span style={s.groupLabel}>{t(ROLE_LABEL_KEY[group.role])}</span>
                <span style={s.groupSubtitle}>{t(ROLE_SUBTITLE_KEY[group.role])}</span>
                <span style={{ ...s.summary, marginLeft: "auto" }}>
                  {t("smartDiff.filesCount", { count: group.files.length })}
                </span>
              </div>
              <div style={s.groupFiles}>
                {group.files.map((sf) => {
                  const prFile = findPrFile(files, sf.path) ?? {
                    path: sf.path,
                    additions: sf.additions,
                    deletions: sf.deletions,
                    patch: null,
                  };
                  const forcedOpen = openOverrides[sf.path];
                  const hasFindings = sf.finding_lines.length > 0;
                  return (
                    <div key={sf.path} style={s.fileWrap}>
                      {hasFindings && (
                        <div style={s.findingsRow}>
                          <Chip
                            icon="AlertTriangle"
                            onClick={() => handleFindingsClick(sf.path, sf.finding_lines)}
                          >
                            {t("smartDiff.findingsBadge", { count: sf.finding_lines.length })}
                          </Chip>
                        </div>
                      )}
                      <FileCard
                        key={forcedOpen ? `${sf.path}:open` : sf.path}
                        file={prFile}
                        commenting={commenting}
                        defaultOpen={forcedOpen ?? defaultOpenForRole(group.role)}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
