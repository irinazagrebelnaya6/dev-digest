import type { CSSProperties } from "react";

export const s = {
  body: { display: "flex", gap: 24, padding: 24 } satisfies CSSProperties,
  col: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 16 } satisfies CSSProperties,
  inputTabs: { display: "flex", gap: 4, borderBottom: "1px solid var(--border)", marginBottom: 10 } satisfies CSSProperties,
  inputTab: (active: boolean): CSSProperties => ({
    padding: "8px 12px",
    fontSize: 13,
    fontWeight: active ? 600 : 500,
    color: active ? "var(--text-primary)" : "var(--text-secondary)",
    borderBottom: "2px solid " + (active ? "var(--accent)" : "transparent"),
    marginBottom: -1,
    background: "none",
    border: "none",
    cursor: "pointer",
  }),
  panelHeader: { display: "flex", alignItems: "center", gap: 10, justifyContent: "space-between" } satisfies CSSProperties,
  panelTitle: { fontSize: 13, fontWeight: 600 } satisfies CSSProperties,
  lastRun: (ok: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 12px",
    borderRadius: 7,
    fontSize: 13,
    color: ok ? "var(--ok)" : "var(--crit)",
    background: ok ? "var(--ok-bg)" : "var(--crit-bg)",
  }),
  footer: { display: "flex", alignItems: "center", gap: 12 } satisfies CSSProperties,
  runOnSave: { display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--text-secondary)" } satisfies CSSProperties,
  footerActions: { display: "flex", gap: 8, marginLeft: "auto" } satisfies CSSProperties,
} as const;
