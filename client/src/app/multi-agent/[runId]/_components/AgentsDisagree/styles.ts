import type { CSSProperties } from "react";

export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 12 } satisfies CSSProperties,
  header: { display: "flex", alignItems: "center", justifyContent: "space-between" } satisfies CSSProperties,
  toggleWrap: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  toggleLabel: { fontSize: 13, color: "var(--text-secondary)" } satisfies CSSProperties,
  group: {
    border: "1px solid var(--border)",
    borderRadius: 9,
    background: "var(--bg-elevated)",
    overflow: "hidden",
  } satisfies CSSProperties,
  groupHeader: { display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: "1px solid var(--border)" } satisfies CSSProperties,
  groupTitle: { fontSize: 13.5, fontWeight: 600 } satisfies CSSProperties,
  takes: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" } satisfies CSSProperties,
  take: { padding: 14, borderRight: "1px solid var(--border)" } satisfies CSSProperties,
  takeAgent: { fontSize: 13, fontWeight: 600, marginBottom: 6 } satisfies CSSProperties,
  takeVerdict: (color: string): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.03em",
    textTransform: "uppercase",
    color,
    marginBottom: 6,
  }),
  takeNote: { fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.4 } satisfies CSSProperties,
  empty: { fontSize: 13, color: "var(--text-muted)", padding: "20px 0" } satisfies CSSProperties,
};
