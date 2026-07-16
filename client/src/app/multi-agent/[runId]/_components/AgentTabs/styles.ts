import type { CSSProperties } from "react";

export const s = {
  summaryCard: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    padding: 16,
    marginTop: 16,
    border: "1px solid var(--border)",
    borderRadius: 9,
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  summaryInfo: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  summaryName: { fontSize: 14, fontWeight: 700 } satisfies CSSProperties,
  summaryText: { fontSize: 13, color: "var(--text-secondary)", marginTop: 2 } satisfies CSSProperties,
  summaryMeta: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flexShrink: 0 } satisfies CSSProperties,
  summaryMetaLine: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 12, padding: "18px 0" } satisfies CSSProperties,
  empty: { fontSize: 13, color: "var(--text-muted)", padding: "24px 0" } satisfies CSSProperties,
};
