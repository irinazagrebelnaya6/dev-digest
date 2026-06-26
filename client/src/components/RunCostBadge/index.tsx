"use client";

import React from "react";
import type { CSSProperties } from "react";

interface RunCostBadgeProps {
  costUsd?: number | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
  /** compact: "$0.012"  |  detailed: "$0.014 · 8.2K→1.3K"  (default: compact) */
  variant?: "compact" | "detailed";
  style?: CSSProperties;
}

function formatCost(usd: number): string {
  if (usd < 0.001) return `$${usd.toFixed(6)}`;
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 0.1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
}

const baseStyle: CSSProperties = {
  fontSize: 12,
  color: "var(--text-secondary)",
  fontVariantNumeric: "tabular-nums",
};

export function RunCostBadge({
  costUsd,
  tokensIn,
  tokensOut,
  variant = "compact",
  style,
}: RunCostBadgeProps) {
  if (variant === "compact") {
    return (
      <span style={{ ...baseStyle, ...style }}>
        {costUsd != null ? formatCost(costUsd) : "—"}
      </span>
    );
  }

  // detailed variant
  const hasCost = costUsd != null;
  const hasTokens = tokensIn != null && tokensOut != null;

  if (!hasCost && !hasTokens) return null;

  const parts: string[] = [];
  if (hasCost) parts.push(formatCost(costUsd!));
  if (hasTokens) {
    const tokens = `${formatTokens(tokensIn!)}→${formatTokens(tokensOut!)}`;
    if (hasCost) parts.push(`· ${tokens}`);
    else parts.push(tokens);
  }

  return (
    <span style={{ ...baseStyle, ...style }}>{parts.join(" ")}</span>
  );
}