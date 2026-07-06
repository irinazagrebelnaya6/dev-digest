import type React from "react";

/** Co-located styles for BlastTab (React.CSSProperties `s` object convention). */
export const s: Record<string, React.CSSProperties> = {
  banner: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid var(--amber-border, #b4881f)",
    background: "var(--amber-bg, rgba(180,136,31,0.08))",
    color: "var(--text-secondary)",
    fontSize: 13,
    marginBottom: 16,
  },
  summary: {
    fontSize: 14,
    lineHeight: 1.55,
    color: "var(--text-secondary)",
    marginBottom: 18,
  },
  symbolBlock: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: "14px 0",
    borderTop: "1px solid var(--border-subtle, rgba(127,127,127,0.16))",
  },
  symbolHead: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  symbolName: { fontSize: 14, fontWeight: 700, color: "var(--text-primary)" },
  callersList: { display: "flex", flexDirection: "column", gap: 4, paddingLeft: 18 },
  callerRow: { display: "flex", alignItems: "baseline", gap: 8, fontSize: 13 },
  callerName: { color: "var(--text-primary)", fontWeight: 600 },
  rowLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  },
  badgeRow: { display: "flex", flexWrap: "wrap", gap: 6, paddingLeft: 18 },
  emptyBody: { fontSize: 13, color: "var(--text-muted)" },
  footer: { marginTop: 18, display: "flex", justifyContent: "flex-end" },
};
