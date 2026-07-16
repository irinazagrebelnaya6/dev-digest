import type { CSSProperties } from "react";

export const s = {
  page: {
    padding: "24px 32px 60px",
    maxWidth: 1080,
    margin: "0 auto",
    display: "flex",
    flexDirection: "column",
    gap: 24,
  } satisfies CSSProperties,
  topRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 } satisfies CSSProperties,
  titleGroup: { display: "flex", alignItems: "baseline", gap: 10 } satisfies CSSProperties,
  h1: { fontSize: 20, fontWeight: 700, letterSpacing: "-0.01em", margin: 0 } satisfies CSSProperties,
  subtitle: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
  metaRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 } satisfies CSSProperties,
  prLine: { display: "flex", alignItems: "center", gap: 10, fontSize: 13.5 } satisfies CSSProperties,
  prNumber: { color: "var(--text-muted)" } satisfies CSSProperties,
  fanOutSummary: { fontSize: 12.5, color: "var(--text-muted)" } satisfies CSSProperties,
  statusBadge: (color: string): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12.5,
    fontWeight: 600,
    color,
  }),
};
