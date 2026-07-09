import type { CSSProperties } from "react";

/** Co-located styles for IntentCard. */
export const s = {
  summary: {
    fontStyle: "italic",
    color: "var(--text-secondary)",
    borderLeft: "3px solid var(--border-strong)",
    padding: "2px 14px",
    margin: "0 0 16px",
    fontSize: 14,
    lineHeight: 1.55,
  } satisfies CSSProperties,
  columns: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 20,
  } satisfies CSSProperties,
  columnHeading: (color: string) =>
    ({
      display: "flex",
      alignItems: "center",
      gap: 6,
      fontSize: 12,
      fontWeight: 700,
      letterSpacing: "0.04em",
      textTransform: "uppercase",
      color,
      marginBottom: 8,
    }) satisfies CSSProperties,
  list: {
    margin: 0,
    paddingLeft: 18,
    display: "flex",
    flexDirection: "column",
    gap: 6,
    fontSize: 13.5,
    color: "var(--text-secondary)",
    lineHeight: 1.5,
  } satisfies CSSProperties,
  footer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 18,
    paddingTop: 14,
    borderTop: "1px solid var(--border)",
  } satisfies CSSProperties,
  emptyBody: {
    fontSize: 13.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
} as const;
