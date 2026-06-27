/* PRRow — one clickable row in the PR list table. Ported from screen_dashboard.jsx. */
"use client";

import React from "react";
import ReactDOM from "react-dom";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Icon, Avatar, Badge, CircularScore } from "@devdigest/ui";
import { SeverityBadge } from "@/vendor/ui/primitives/Badge";
import { SEV } from "@/vendor/ui/primitives/tokens";
import type { Severity } from "@/vendor/ui/primitives/tokens";
import type { PrMeta } from "@/lib/types";
import { SIZE_COLOR, STATUS_META } from "../../constants";
import { relativeTime, sizeOf } from "../../helpers";
import { s } from "../../styles";
import { RunCostBadge } from "@/components/RunCostBadge";

type FindingPreview = NonNullable<PrMeta["findings_preview"]>[number];

function FindingsPopover({
  findings,
  anchorRect,
}: {
  findings: FindingPreview[];
  anchorRect: DOMRect;
}) {
  const total = findings.length;
  const style: React.CSSProperties = {
    position: "fixed",
    top: anchorRect.bottom + 8,
    left: Math.max(8, anchorRect.left - 8),
    zIndex: 9999,
    width: 360,
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    borderRadius: 10,
    boxShadow: "0 8px 32px rgba(0,0,0,.35)",
    padding: "12px 0 8px",
    pointerEvents: "none",
  };
  return ReactDOM.createPortal(
    <div style={style}>
      <div style={{ padding: "0 14px 10px", fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: "var(--text-muted)", textTransform: "uppercase" }}>
        {total} finding{total === 1 ? "" : "s"} in this run
      </div>
      {findings.map((f, i) => {
        const sev = SEV[f.severity as Severity] ?? SEV.WARNING;
        const I = Icon[sev.icon as keyof typeof Icon] as React.ComponentType<{ size: number; style?: React.CSSProperties }>;
        return (
          <div key={i} style={{ padding: "8px 14px", borderTop: i === 0 ? "1px solid var(--border)" : "none" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 3 }}>
              <I size={13} style={{ color: sev.c, flexShrink: 0 }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {f.title}
              </span>
              <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-muted)", flexShrink: 0 }}>
                {Math.round(f.confidence * 100)}% conf
              </span>
            </div>
            <div style={{ fontSize: 11, color: "var(--accent-text)", fontFamily: "var(--font-mono, monospace)", marginBottom: 4 }}>
              {f.file}:{f.start_line}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.45, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
              {f.rationale}
            </div>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}

export function PRRow({ pr, repoId }: { pr: PrMeta; repoId: string }) {
  const t = useTranslations("prReview");
  const router = useRouter();
  const [h, setH] = React.useState(false);
  const [popoverRect, setPopoverRect] = React.useState<DOMRect | null>(null);
  const st = STATUS_META[pr.status] ?? STATUS_META.needs_review!;
  const { size, lines } = sizeOf(pr);
  const reviewed = pr.score != null;
  return (
    <div
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      onClick={() => router.push(`/repos/${repoId}/pulls/${pr.number}`)}
      style={s.row(h)}
    >
      <div style={s.rowTitleCell}>
        <Icon.GitPullRequest size={15} style={s.rowIcon(st.c)} />
        <div style={s.rowTitleWrap}>
          <div style={s.rowTitle(h)}>{pr.title}</div>
          <span className="mono" style={s.rowNumber}>
            #{pr.number}
          </span>
        </div>
      </div>
      <div style={s.authorCell}>
        <Avatar name={pr.author} size={18} />
        {pr.author}
      </div>
      <div>
        <Badge
          color={SIZE_COLOR[size]}
          bg="transparent"
          style={s.sizeBadgeBorder(SIZE_COLOR[size]!)}
        >
          {size} · {lines}
        </Badge>
      </div>
      <div style={s.scoreCell}>
        {reviewed ? (
          <CircularScore score={pr.score!} size={34} stroke={3} />
        ) : (
          <span style={s.muted}>—</span>
        )}
      </div>
      <div style={s.costCell}>
        <RunCostBadge costUsd={pr.cost_usd} />
      </div>
      <div
        style={s.findingsCell}
        onMouseEnter={(e) => {
          if (pr.findings_preview?.length) setPopoverRect(e.currentTarget.getBoundingClientRect());
        }}
        onMouseLeave={() => setPopoverRect(null)}
      >
        {pr.findings_breakdown ? (
          (["CRITICAL", "WARNING", "SUGGESTION"] as Severity[])
            .filter((sev) => {
              const key = sev.toLowerCase() as "critical" | "warning" | "suggestion";
              return pr.findings_breakdown![key] > 0;
            })
            .map((sev) => {
              const key = sev.toLowerCase() as "critical" | "warning" | "suggestion";
              return (
                <SeverityBadge key={sev} severity={sev} count={pr.findings_breakdown![key]} compact />
              );
            })
        ) : (
          <span style={s.muted}>—</span>
        )}
        {popoverRect && pr.findings_preview?.length && (
          <FindingsPopover findings={pr.findings_preview} anchorRect={popoverRect} />
        )}
      </div>
      <div>
        <Badge dot color={st.c} bg="transparent">
          {t(`list.status.${st.labelKey}`)}
        </Badge>
      </div>
      <div style={s.updatedCell}>{relativeTime(pr.updated_at)}</div>
    </div>
  );
}
