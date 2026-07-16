/* AgentsDisagree — "Where agents disagree" block (SPEC-06 AC-19..21). Groups
   findings across agents by code location; per agent shows its verdict, with
   "did not flag" (ignored — an enabled, in-run agent found nothing here) kept
   visually + semantically distinct from "did not run" (an agent absent from
   this multi-run — no verdict is ever claimed for it). A "Show only
   conflicts" toggle filters to groups matching the conflict predicate. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, MonoLink, SectionLabel, SeverityBadge, Toggle, type Severity } from "@devdigest/ui";
import type { Conflict } from "@devdigest/shared";
import { isConflictGroup } from "./helpers";
import { s } from "./styles";

function isSeverity(v: string): v is Severity {
  return v === "CRITICAL" || v === "WARNING" || v === "SUGGESTION";
}

export function AgentsDisagree({ conflicts }: { conflicts: Conflict[] }) {
  const t = useTranslations("multiAgent");
  const [onlyConflicts, setOnlyConflicts] = React.useState(false);

  const shown = onlyConflicts ? conflicts.filter(isConflictGroup) : conflicts;

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <SectionLabel icon="Activity">{t("disagree.title")}</SectionLabel>
        <div style={s.toggleWrap}>
          <span style={s.toggleLabel}>{t("disagree.showOnlyConflicts")}</span>
          <Toggle on={onlyConflicts} onChange={setOnlyConflicts} size={16} />
        </div>
      </div>

      {shown.length === 0 ? (
        <div style={s.empty}>{onlyConflicts ? t("disagree.emptyFiltered") : t("disagree.empty")}</div>
      ) : (
        shown.map((c) => (
          <div key={`${c.file}:${c.line}`} style={s.group}>
            <div style={s.groupHeader}>
              {/* Untrusted (agent-derived) file path — inert mono text, no href. */}
              <MonoLink>
                {c.file}:{c.line}
              </MonoLink>
              <span style={s.groupTitle}>{c.title}</span>
            </div>
            <div style={s.takes}>
              {c.takes.map((take) => (
                <div key={take.agent_id} style={s.take}>
                  <div style={s.takeAgent}>{take.persona}</div>
                  {isSeverity(take.verdict) ? (
                    <SeverityBadge severity={take.verdict} />
                  ) : take.verdict === "ignored" ? (
                    <div style={s.takeVerdict("var(--text-muted)")} data-verdict="ignored">
                      <Icon.Dot size={12} />
                      {t("disagree.didNotFlag")}
                    </div>
                  ) : (
                    <div style={s.takeVerdict("var(--text-muted)")} data-verdict="did_not_run">
                      <Icon.Slash size={12} />
                      {t("disagree.didNotRun")}
                    </div>
                  )}
                  <div style={s.takeNote}>{take.note}</div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
