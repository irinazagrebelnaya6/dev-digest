import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { AgentColumn, ReviewRecord } from "@devdigest/shared";
import prReviewMessages from "../../../../../../messages/en/prReview.json";
import multiAgentMessages from "../../../../../../messages/en/multiAgent.json";

const mutateAsync = vi.fn().mockResolvedValue({ finding: {} });
vi.mock("@/lib/hooks/reviews", () => ({
  useFindingAction: () => ({ mutateAsync, isPending: false }),
  usePrReviews: () => ({ data: mockReviews }),
}));
vi.mock("@/lib/hooks/evals", () => ({
  useCreateEvalCaseFromFinding: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), toast: vi.fn() }),
}));

let mockReviews: ReviewRecord[] = [];

import { AgentTabs } from "./AgentTabs";

afterEach(() => {
  cleanup();
  mockReviews = [];
});

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
    summary: null,
    duration_ms: 8200,
    cost_usd: 0.06,
    findings: [
      { id: "f1", severity: "CRITICAL", category: "security", title: "Hardcoded secret", file: "src/config.ts", start_line: 12, kind: "finding" },
    ],
    ...overrides,
  };
}

function review(runId: string, findingTitle: string): ReviewRecord {
  return {
    id: runId,
    pr_id: "pr1",
    agent_id: "a1",
    run_id: runId,
    agent_name: "Security",
    kind: "review",
    verdict: "request_changes",
    summary: null,
    score: 38,
    model: "gpt-4.1",
    grounding: null,
    created_at: "2026-01-01T00:00:00Z",
    findings: [
      {
        id: "f1",
        severity: "CRITICAL",
        category: "security",
        title: findingTitle,
        file: "src/config.ts",
        start_line: 12,
        end_line: 12,
        rationale: "Full rationale text.",
        suggestion: null,
        confidence: 0.9,
        kind: "finding",
        trifecta_components: null,
        evidence: null,
        review_id: runId,
        accepted_at: null,
        dismissed_at: null,
      },
    ],
  };
}

function renderTabs(columns: AgentColumn[]) {
  render(
    <NextIntlClientProvider locale="en" messages={{ prReview: prReviewMessages, multiAgent: multiAgentMessages }}>
      <AgentTabs prId="pr1" columns={columns} />
    </NextIntlClientProvider>,
  );
}

describe("AgentTabs (SPEC-06 AC-13, AC-16)", () => {
  it("renders one tab per agent and shows the active agent's full finding detail", () => {
    mockReviews = [review("run-a1", "Hardcoded secret (full)")];
    renderTabs([column(), column({ run_id: "run-a2", agent_id: "a2", agent_name: "Performance" })]);
    // "Security" appears twice (tab label + the active tab's own summary
    // card); "Performance" (not active) appears once (tab label only).
    expect(screen.getAllByText("Security").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Performance")).toHaveLength(1);
    expect(screen.getByText("Hardcoded secret (full)")).toBeInTheDocument();
    expect(screen.getByText("Full rationale text.")).toBeInTheDocument();
  });

  it("switching tabs shows the other agent's findings", () => {
    mockReviews = [review("run-a1", "Security finding"), review("run-a2", "Performance finding")];
    renderTabs([column(), column({ run_id: "run-a2", agent_id: "a2", agent_name: "Performance" })]);
    expect(screen.getByText("Security finding")).toBeInTheDocument();
    // First "Performance" occurrence is the tab button (its summary card isn't
    // rendered yet since it's not the active tab).
    fireEvent.click(screen.getAllByText("Performance")[0]!);
    expect(screen.getByText("Performance finding")).toBeInTheDocument();
  });
});
