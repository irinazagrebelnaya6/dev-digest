import type { CSSProperties } from "react";

export const s = {
  wrap: { padding: "24px 28px", display: "flex", flexDirection: "column", gap: 24 } satisfies CSSProperties,
  metricsRow: { display: "flex", gap: 12 } satisfies CSSProperties,
  casesHeader: { display: "flex", alignItems: "center", gap: 10, justifyContent: "space-between" } satisfies CSSProperties,
  casesHeaderLeft: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  casesTitle: { fontSize: 15, fontWeight: 600 } satisfies CSSProperties,
  casesActions: { display: "flex", alignItems: "center", gap: 8 } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  row: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "12px 14px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  stateIcon: { flexShrink: 0 } satisfies CSSProperties,
  info: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 } satisfies CSSProperties,
  nameRow: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" } satisfies CSSProperties,
  name: { fontSize: 14, fontWeight: 600, fontFamily: "var(--font-mono, monospace)" } satisfies CSSProperties,
  stateLabel: (color: string): CSSProperties => ({ fontSize: 12, fontWeight: 600, color }),
  subtitle: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  tags: { display: "flex", alignItems: "center", gap: 8, flexShrink: 0 } satisfies CSSProperties,
  actions: { display: "flex", alignItems: "center", gap: 4, flexShrink: 0 } satisfies CSSProperties,
  confirmRow: { display: "flex", alignItems: "center", gap: 6, flexShrink: 0 } satisfies CSSProperties,
} as const;
