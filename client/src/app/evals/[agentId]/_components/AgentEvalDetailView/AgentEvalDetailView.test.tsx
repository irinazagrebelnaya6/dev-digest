import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent } from "@devdigest/shared";
import messages from "../../../../../../messages/en/eval.json";
import type { EvalDashboard, EvalRunRecord } from "@/lib/hooks/evals";

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const AGENT: Agent = {
  id: "agent1",
  name: "Security Reviewer",
  description: "",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "x",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 7,
};

let mockDashboard: EvalDashboard | undefined;
let mockRuns: EvalRunRecord[] = [];
const runAllMutateAsync = vi.fn().mockResolvedValue({ batch_id: "b1", runs: [] });

vi.mock("@/lib/hooks/agents", () => ({
  useAgent: () => ({ data: AGENT, isLoading: false, isError: false, refetch: vi.fn() }),
}));

vi.mock("@/lib/hooks/evals", async () => {
  const actual = await vi.importActual<typeof import("@/lib/hooks/evals")>("@/lib/hooks/evals");
  return {
    ...actual,
    useAgentEvalDashboard: () => ({ data: mockDashboard, isLoading: !mockDashboard }),
    useAgentEvalRuns: () => ({ data: mockRuns }),
    useRunAgentEvalCases: () => ({ mutateAsync: runAllMutateAsync, isPending: false }),
  };
});

vi.mock("@/lib/toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), toast: vi.fn() }),
}));

import { AgentEvalDetailView } from "./AgentEvalDetailView";

afterEach(() => {
  cleanup();
  mockDashboard = undefined;
  mockRuns = [];
  runAllMutateAsync.mockClear();
});

function run(batchId: string, ranAt: string, pass: boolean): EvalRunRecord {
  return {
    id: `${batchId}-c1`,
    case_id: "c1",
    case_name: "c1",
    ran_at: ranAt,
    actual_output: { produced_findings: [], meta: { batch_id: batchId, agent_id: "agent1", agent_version: 7 } },
    pass,
    recall: 0.82,
    precision: 0.91,
    citation_accuracy: 0.95,
    duration_ms: 1200,
    cost_usd: 0.02,
  };
}

function dashboard(): EvalDashboard {
  return {
    owner_kind: "agent",
    owner_id: "agent1",
    cases_total: 20,
    current: { recall: 0.82, precision: 0.91, citation_accuracy: 0.95, traces_passed: 17, traces_total: 20, cost_usd: 0.23 },
    delta: { recall: 0.04, precision: -0.02, citation_accuracy: 0.01 },
    trend: [
      { ran_at: "2026-05-27T16:40:00.000Z", recall: 0.78, precision: 0.93, citation_accuracy: 0.94, pass_rate: 0.8, cost_usd: 0.21 },
      { ran_at: "2026-05-29T09:14:00.000Z", recall: 0.82, precision: 0.91, citation_accuracy: 0.95, pass_rate: 0.85, cost_usd: 0.23 },
    ],
    recent_runs: [],
    alert: "Precision dipped 2pts on v7 — a new false positive slipped in.",
  };
}

function renderWithIntl(ui: React.ReactElement) {
  return render(<NextIntlClientProvider locale="en" messages={{ eval: messages }}>{ui}</NextIntlClientProvider>);
}

describe("AgentEvalDetailView (AC-18)", () => {
  it("renders +/- deltas against the prior batch and the alert banner", () => {
    mockDashboard = dashboard();
    mockRuns = [run("batch-v6", "2026-05-27T16:40:00.000Z", true), run("batch-v7", "2026-05-29T09:14:00.000Z", true)];
    renderWithIntl(<AgentEvalDetailView agentId="agent1" />);

    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
    expect(screen.getByText(/Precision dipped 2pts/)).toBeInTheDocument();
    // MetricCard renders the delta value alongside an up/down arrow icon.
    expect(screen.getByText("0.04")).toBeInTheDocument();
  });

  it("feeds the trend chart >= 2 points once 2+ runs exist (no empty state)", () => {
    mockDashboard = dashboard();
    mockRuns = [run("batch-v6", "2026-05-27T16:40:00.000Z", true), run("batch-v7", "2026-05-29T09:14:00.000Z", true)];
    renderWithIntl(<AgentEvalDetailView agentId="agent1" />);
    expect(screen.getByText("Metric trend")).toBeInTheDocument();
    // With >=2 trend points the chart renders instead of the "no runs" empty state.
    expect(screen.queryByText("No runs yet. Create an eval case and run it.")).not.toBeInTheDocument();
  });

  it("enables Compare only once exactly two runs are selected", () => {
    mockDashboard = dashboard();
    mockRuns = [run("batch-v6", "2026-05-27T16:40:00.000Z", true), run("batch-v7", "2026-05-29T09:14:00.000Z", true)];
    renderWithIntl(<AgentEvalDetailView agentId="agent1" />);

    const compareBtn = screen.getByText("Compare").closest("button")!;
    expect(compareBtn).toBeDisabled();

    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]!);
    expect(compareBtn).toBeDisabled();
    fireEvent.click(checkboxes[1]!);
    expect(compareBtn).not.toBeDisabled();
  });
});
