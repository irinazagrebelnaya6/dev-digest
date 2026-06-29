import type { CSSProperties } from "react";

export const s = {
  wrap: { padding: "24px 28px", display: "flex", flexDirection: "column", gap: 16 } satisfies CSSProperties,
  header: { display: "flex", alignItems: "flex-start", gap: 12, justifyContent: "space-between" } satisfies CSSProperties,
  title: { fontSize: 15, fontWeight: 600 } satisfies CSSProperties,
  hint: { fontSize: 13, color: "var(--text-secondary)", marginTop: 2 } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 6 } satisfies CSSProperties,
  row: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "10px 14px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  order: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-muted)",
    width: 20,
    textAlign: "center",
    flexShrink: 0,
  } satisfies CSSProperties,
  info: { flex: 1, display: "flex", alignItems: "center", gap: 10, minWidth: 0 } satisfies CSSProperties,
  name: { fontSize: 14, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } satisfies CSSProperties,
  type: { fontSize: 11, color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,
  actions: { display: "flex", alignItems: "center", gap: 6, flexShrink: 0 } satisfies CSSProperties,
  iconBtn: {
    background: "none",
    border: "none",
    cursor: "pointer",
    color: "var(--text-secondary)",
    display: "inline-flex",
    padding: 3,
    borderRadius: 4,
  } satisfies CSSProperties,
} as const;
