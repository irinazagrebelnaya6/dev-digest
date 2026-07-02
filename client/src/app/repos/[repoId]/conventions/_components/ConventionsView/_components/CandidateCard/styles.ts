import type { CSSProperties } from "react";
import type { ConventionStatus } from "@devdigest/shared";

const STATUS_BORDER: Record<ConventionStatus, string> = {
  accepted: "var(--green, #22c55e)",
  rejected: "var(--border)",
  pending: "var(--border)",
};

export const s = {
  card: (status: ConventionStatus): CSSProperties => ({
    background: "var(--bg-surface)",
    border: `1px solid ${STATUS_BORDER[status]}`,
    borderRadius: 10,
    padding: "14px 16px",
    display: "flex",
    flexDirection: "column",
    gap: 10,
    opacity: status === "rejected" ? 0.5 : 1,
    transition: "opacity 0.15s",
  }),
  headerRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
  } satisfies CSSProperties,
  categoryBadge: (color: string): CSSProperties => ({
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: "0.05em",
    textTransform: "uppercase" as const,
    color,
    background: `${color}18`,
    borderRadius: 4,
    padding: "2px 6px",
    flexShrink: 0,
    marginTop: 2,
  }),
  rule: {
    flex: 1,
    fontSize: 13,
    fontWeight: 500,
    lineHeight: 1.45,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  evidenceRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  evidenceLink: {
    fontSize: 12,
    color: "var(--text-secondary)",
    textDecoration: "none",
    fontFamily: "var(--font-mono, monospace)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
    maxWidth: 260,
  } satisfies CSSProperties,
  confidenceRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  } satisfies CSSProperties,
  confidenceBar: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    background: "var(--bg-base, #0d1117)",
    overflow: "hidden",
  } satisfies CSSProperties,
  confidenceFill: (pct: number): CSSProperties => ({
    height: "100%",
    width: `${pct}%`,
    borderRadius: 2,
    background: pct >= 70 ? "var(--green, #22c55e)" : pct >= 50 ? "var(--amber, #f59e0b)" : "var(--crit, #ef4444)",
  }),
  confidencePct: {
    fontSize: 11,
    color: "var(--text-muted)",
    flexShrink: 0,
    width: 32,
    textAlign: "right" as const,
  } satisfies CSSProperties,
  actionRow: {
    display: "flex",
    gap: 6,
    justifyContent: "flex-end",
  } satisfies CSSProperties,
  editBtn: {
    background: "none",
    border: "none",
    cursor: "pointer",
    padding: "2px 4px",
    color: "var(--text-muted)",
    display: "flex",
    alignItems: "center",
    flexShrink: 0,
    marginLeft: "auto",
  } satisfies CSSProperties,
  editRow: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  } satisfies CSSProperties,
  editTextarea: {
    fontSize: 13,
    fontWeight: 500,
    lineHeight: 1.45,
    color: "var(--text-primary)",
    background: "var(--bg-base)",
    border: "1px solid var(--border)",
    borderRadius: 6,
    padding: "6px 8px",
    resize: "vertical" as const,
    width: "100%",
    boxSizing: "border-box" as const,
    fontFamily: "inherit",
    minHeight: 60,
  } satisfies CSSProperties,
  editCategoryInput: {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.05em",
    textTransform: "uppercase" as const,
    background: "var(--bg-base)",
    border: "1px solid var(--border)",
    borderRadius: 4,
    padding: "3px 8px",
    color: "var(--text-secondary)",
    width: 140,
    fontFamily: "inherit",
  } satisfies CSSProperties,
  editActions: {
    display: "flex",
    gap: 6,
    justifyContent: "flex-end",
  } satisfies CSSProperties,
  actionBtn: (kind: "accept" | "reject" | "reset", active: boolean): CSSProperties => ({
    fontSize: 12,
    fontWeight: 600,
    padding: "4px 10px",
    borderRadius: 5,
    border: "1px solid",
    cursor: "pointer",
    transition: "opacity 0.1s",
    borderColor:
      kind === "accept" ? "var(--green, #22c55e)"
      : kind === "reject" ? "var(--crit, #ef4444)"
      : "var(--border)",
    color:
      kind === "accept" ? "var(--green, #22c55e)"
      : kind === "reject" ? "var(--crit, #ef4444)"
      : "var(--text-secondary)",
    background: active
      ? kind === "accept" ? "var(--green, #22c55e)22"
        : kind === "reject" ? "var(--crit, #ef4444)22"
        : "var(--bg-base)"
      : "transparent",
  }),
} as const;
