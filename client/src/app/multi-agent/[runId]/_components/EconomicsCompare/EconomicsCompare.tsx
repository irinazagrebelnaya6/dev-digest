/* EconomicsCompare — 1-vs-N economics comparison (SPEC-06 AC-22). Side-by-side
   total tokens + total dollars for one agent vs the N agents in this
   multi-agent run, reusing the existing `MetricCard`/`BarRow` chart
   primitives (no new chart component). */
"use client";

import { useTranslations } from "next-intl";
import { BarRow, MetricCard, SectionLabel } from "@devdigest/ui";
import type { MultiAgentEconomics } from "@devdigest/shared";
import { s } from "./styles";

export function EconomicsCompare({
  economics,
  agentCount,
}: {
  economics: MultiAgentEconomics;
  agentCount: number;
}) {
  const t = useTranslations("multiAgent");
  const singleLabel = t("economics.single");
  const multiLabel = t("economics.multi", { count: agentCount });
  const maxTokens = Math.max(
    economics.single.tokens_in,
    economics.single.tokens_out,
    economics.multi.tokens_in,
    economics.multi.tokens_out,
    1,
  );

  return (
    <div style={s.wrap}>
      <SectionLabel icon="DollarSign">{t("economics.title", { count: agentCount })}</SectionLabel>
      <div style={s.cards}>
        <MetricCard label={singleLabel} value={`$${economics.single.cost_usd.toFixed(2)}`} />
        <MetricCard label={multiLabel} value={`$${economics.multi.cost_usd.toFixed(2)}`} />
      </div>
      <div style={s.bars}>
        <BarRow
          label={`${singleLabel} · ${t("economics.tokensIn")}`}
          value={economics.single.tokens_in}
          max={maxTokens}
          suffix={String(economics.single.tokens_in)}
        />
        <BarRow
          label={`${singleLabel} · ${t("economics.tokensOut")}`}
          value={economics.single.tokens_out}
          max={maxTokens}
          suffix={String(economics.single.tokens_out)}
        />
        <BarRow
          label={`${multiLabel} · ${t("economics.tokensIn")}`}
          value={economics.multi.tokens_in}
          max={maxTokens}
          suffix={String(economics.multi.tokens_in)}
        />
        <BarRow
          label={`${multiLabel} · ${t("economics.tokensOut")}`}
          value={economics.multi.tokens_out}
          max={maxTokens}
          suffix={String(economics.multi.tokens_out)}
        />
      </div>
    </div>
  );
}
