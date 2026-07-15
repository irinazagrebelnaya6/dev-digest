import type { CSSProperties } from "react";

export const s = {
  row: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    padding: "14px 16px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    textDecoration: "none",
    color: "inherit",
  } satisfies CSSProperties,
  info: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 } satisfies CSSProperties,
  nameRow: { display: "flex", alignItems: "center", gap: 8 } satisfies CSSProperties,
  name: { fontSize: 14, fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
  modelBadge: {
    fontSize: 11,
    color: "var(--text-muted)",
    background: "var(--bg-hover)",
    padding: "1px 6px",
    borderRadius: 4,
  } satisfies CSSProperties,
  meta: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  metrics: { display: "flex", gap: 20, flexShrink: 0 } satisfies CSSProperties,
  metric: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, minWidth: 48 } satisfies CSSProperties,
  metricLabel: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.05em",
    color: "var(--text-muted)",
    textTransform: "uppercase",
  } satisfies CSSProperties,
  metricValue: { fontSize: 15, fontWeight: 700 } satisfies CSSProperties,
} as const;
