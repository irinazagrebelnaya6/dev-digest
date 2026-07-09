import type { CSSProperties } from "react";

/** Co-located styles for SmartDiffViewer. */
export const s = {
  root: { display: "flex", flexDirection: "column", gap: 14 } satisfies CSSProperties,
  topBar: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  heading: {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.07em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  summary: {
    fontSize: 12.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  toggle: {
    display: "inline-flex",
    gap: 6,
    marginLeft: "auto",
  } satisfies CSSProperties,
  groups: { display: "flex", flexDirection: "column", gap: 18 } satisfies CSSProperties,
  group: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  groupHeader: {
    display: "flex",
    alignItems: "baseline",
    gap: 10,
  } satisfies CSSProperties,
  groupLabel: {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  groupSubtitle: {
    fontSize: 12.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  groupFiles: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  fileWrap: { display: "flex", flexDirection: "column" } satisfies CSSProperties,
  findingsRow: {
    display: "flex",
    justifyContent: "flex-end",
    padding: "2px 4px",
  } satisfies CSSProperties,
} as const;
