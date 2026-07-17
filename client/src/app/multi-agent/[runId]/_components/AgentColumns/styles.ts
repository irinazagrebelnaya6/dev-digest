import type { CSSProperties } from "react";

export const s = {
  wrap: { display: "flex", gap: 16, alignItems: "flex-start", overflowX: "auto" } satisfies CSSProperties,
  card: (accent: string): CSSProperties => ({
    flex: "1 1 240px",
    minWidth: 220,
    border: "1px solid var(--border)",
    borderTop: "2px solid " + accent,
    borderRadius: 9,
    background: "var(--bg-elevated)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  }),
  header: { display: "flex", alignItems: "center", gap: 10, padding: 14, borderBottom: "1px solid var(--border)" } satisfies CSSProperties,
  headerInfo: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 } satisfies CSSProperties,
  name: { fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } satisfies CSSProperties,
  statusLine: (color: string): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    color,
  }),
  metaLine: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  findings: { display: "flex", flexDirection: "column", gap: 8, padding: 12, flex: 1 } satisfies CSSProperties,
  findingRow: { display: "flex", flexDirection: "column", gap: 3, padding: "8px 10px", borderRadius: 7, background: "var(--bg-surface)" } satisfies CSSProperties,
  findingTitle: { fontSize: 13, fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
  empty: { fontSize: 12.5, color: "var(--text-muted)", padding: "4px 2px" } satisfies CSSProperties,
  footer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 14px",
    borderTop: "1px solid var(--border)",
  } satisfies CSSProperties,
  footerCount: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
};
