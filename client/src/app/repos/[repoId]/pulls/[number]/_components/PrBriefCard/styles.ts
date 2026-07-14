import type { CSSProperties } from "react";

/** Co-located styles for PrBriefCard. */
export const s = {
  headerRight: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  } satisfies CSSProperties,
  banner: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12.5,
    color: "var(--text-secondary)",
    background: "var(--bg-hover)",
    border: "1px solid var(--border)",
    borderRadius: 6,
    padding: "8px 12px",
    marginBottom: 12,
  } satisfies CSSProperties,
  what: {
    fontSize: 13.5,
    fontWeight: 650,
    color: "var(--text-primary)",
    marginBottom: 6,
  } satisfies CSSProperties,
  why: {
    marginBottom: 12,
  } satisfies CSSProperties,
  levelRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 14,
  } satisfies CSSProperties,
  levelLabel: {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  sectionHeading: {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    marginTop: 16,
    marginBottom: 8,
  } satisfies CSSProperties,
  riskBlock: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    padding: "10px 0",
    borderTop: "1px solid var(--border)",
  } satisfies CSSProperties,
  focusList: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    paddingLeft: 0,
    margin: 0,
    listStyle: "none",
  } satisfies CSSProperties,
  focusItem: {
    display: "flex",
    alignItems: "baseline",
    gap: 8,
    fontSize: 13.5,
  } satisfies CSSProperties,
  focusIndex: {
    fontSize: 12,
    fontWeight: 700,
    color: "var(--text-muted)",
    minWidth: 16,
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
