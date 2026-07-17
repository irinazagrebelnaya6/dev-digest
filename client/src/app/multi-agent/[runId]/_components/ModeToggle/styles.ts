import type { CSSProperties } from "react";

export const s = {
  wrap: {
    display: "inline-flex",
    border: "1px solid var(--border-strong)",
    borderRadius: 7,
    padding: 2,
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  btn: (active: boolean): CSSProperties => ({
    padding: "5px 14px",
    borderRadius: 5,
    border: "none",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    background: active ? "var(--bg-hover)" : "transparent",
    color: active ? "var(--text-primary)" : "var(--text-secondary)",
  }),
};
