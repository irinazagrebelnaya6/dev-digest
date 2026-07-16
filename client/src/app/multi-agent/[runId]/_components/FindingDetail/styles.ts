import type { CSSProperties } from "react";

export const s = {
  card: {
    border: "1px solid var(--border)",
    borderRadius: 9,
    background: "var(--bg-elevated)",
    overflow: "hidden",
  } satisfies CSSProperties,
  header: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    padding: 14,
    cursor: "pointer",
  } satisfies CSSProperties,
  headerMain: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 } satisfies CSSProperties,
  titleRow: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" } satisfies CSSProperties,
  title: { fontSize: 14, fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
  metaRow: { display: "flex", alignItems: "center", gap: 12 } satisfies CSSProperties,
  chevron: (open: boolean): CSSProperties => ({
    color: "var(--text-muted)",
    transform: open ? "rotate(180deg)" : "none",
    transition: "transform .12s",
    flexShrink: 0,
  }),
  body: { padding: "0 14px 14px", display: "flex", flexDirection: "column", gap: 12 } satisfies CSSProperties,
  prose: { fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.55 } satisfies CSSProperties,
  suggestionWrap: {
    background: "var(--bg-surface)",
    border: "1px solid var(--border)",
    borderRadius: 7,
    padding: 12,
  } satisfies CSSProperties,
  suggestionLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    marginBottom: 6,
  } satisfies CSSProperties,
  actions: { display: "flex", gap: 8, flexWrap: "wrap" } satisfies CSSProperties,
  replyFooter: { display: "flex", justifyContent: "flex-end", gap: 8 } satisfies CSSProperties,
};
