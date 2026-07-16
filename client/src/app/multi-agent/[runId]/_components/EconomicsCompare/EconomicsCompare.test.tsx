import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { MultiAgentEconomics } from "@devdigest/shared";
import messages from "../../../../../../messages/en/multiAgent.json";

import { EconomicsCompare } from "./EconomicsCompare";

afterEach(cleanup);

const economics: MultiAgentEconomics = {
  single: { tokens_in: 1200, tokens_out: 400, cost_usd: 0.05 },
  multi: { tokens_in: 4800, tokens_out: 1600, cost_usd: 0.2 },
};

describe("EconomicsCompare (SPEC-06 AC-22)", () => {
  it("renders 1-vs-N totals side by side (tokens + dollars)", () => {
    render(
      <NextIntlClientProvider locale="en" messages={{ multiAgent: messages }}>
        <EconomicsCompare economics={economics} agentCount={4} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("1 agent")).toBeInTheDocument();
    expect(screen.getByText("4 agents")).toBeInTheDocument();
    expect(screen.getByText("$0.05")).toBeInTheDocument();
    expect(screen.getByText("$0.20")).toBeInTheDocument();
  });
});
