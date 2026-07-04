import type { CSSProperties } from "react";

/** Co-located styles for RiskAreasCard. */
export const s = {
  tabRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 4,
  } satisfies CSSProperties,
  tab: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "5px 12px",
    borderRadius: 6,
    border: "1px solid",
    fontSize: 12.5,
    lineHeight: 1,
    cursor: "pointer",
    background: "transparent",
  } satisfies CSSProperties,
  tabDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
  } satisfies CSSProperties,
  tabCount: {
    fontSize: 11.5,
    fontWeight: 700,
    fontVariantNumeric: "tabular-nums",
  } satisfies CSSProperties,
  riskBlock: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    padding: "12px 0",
    borderTop: "1px solid var(--border)",
  } satisfies CSSProperties,
  riskTitle: {
    fontSize: 13.5,
    fontWeight: 650,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  refsRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 12,
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
