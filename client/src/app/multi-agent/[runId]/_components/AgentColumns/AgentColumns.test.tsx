import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AgentColumn } from "@devdigest/shared";
import messages from "../../../../../../messages/en/multiAgent.json";

vi.mock("@/lib/hooks/reviews", () => ({
  useRunEvents: () => ({ events: [], running: false }),
}));

import { AgentColumns } from "./AgentColumns";

afterEach(cleanup);

function column(overrides: Partial<AgentColumn> = {}): AgentColumn {
  return {
    run_id: "run-a1",
    agent_id: "a1",
    agent_name: "Security",
    provider: "openai",
    model: "gpt-4.1",
    status: "done",
    verdict: "request_changes",
    score: 38,
    summary: "Two critical exposures.",
    duration_ms: 8200,
    cost_usd: 0.06,
    findings: [
      { id: "f1", severity: "CRITICAL", category: "security", title: "Hardcoded secret", file: "src/config.ts", start_line: 12, kind: "finding" },
    ],
    ...overrides,
  };
}

function renderColumns(columns: AgentColumn[], onViewTrace = vi.fn()) {
  const qc = new QueryClient();
  render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ multiAgent: messages }}>
        <AgentColumns runId="run-1" columns={columns} onViewTrace={onViewTrace} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return onViewTrace;
}

describe("AgentColumns (SPEC-06 AC-13..15)", () => {
  it("AC-14: renders one lane per agent with an icon+text status (not color alone)", () => {
    renderColumns([column({ status: "running" }), column({ run_id: "run-a2", agent_name: "Performance", status: "failed" })]);
    const statuses = screen.getAllByTestId("column-status");
    expect(statuses).toHaveLength(2);
    expect(statuses[0]).toHaveTextContent("Running");
    expect(statuses[1]).toHaveTextContent("Failed");
    // icon+text: the status node always contains an svg icon alongside the label.
    expect(statuses[0]!.querySelector("svg")).toBeTruthy();
    expect(statuses[1]!.querySelector("svg")).toBeTruthy();
  });

  it("AC-15: 'View trace' targets the agent's run_id", () => {
    const onViewTrace = renderColumns([column({ run_id: "run-a1" }), column({ run_id: "run-a2", agent_name: "Performance" })]);
    const traceLinks = screen.getAllByText("View trace");
    fireEvent.click(traceLinks[1]!);
    expect(onViewTrace).toHaveBeenCalledWith("run-a2");
  });

  it("shows the finding count and title per column", () => {
    renderColumns([column()]);
    expect(screen.getByText("1 finding")).toBeInTheDocument();
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
  });
});
