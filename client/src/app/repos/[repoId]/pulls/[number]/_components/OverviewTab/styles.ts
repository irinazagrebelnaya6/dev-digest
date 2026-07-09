import type { CSSProperties } from "react";

export const s = {
  descriptionBox: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 18,
    fontSize: 14,
    color: "var(--text-secondary)",
    whiteSpace: "pre-wrap",
    lineHeight: 1.55,
  } satisfies CSSProperties,
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
    gap: 24,
    alignItems: "start",
  } satisfies CSSProperties,
  col: {
    display: "flex",
    flexDirection: "column",
    gap: 24,
    minWidth: 0,
  } satisfies CSSProperties,
} as const;
