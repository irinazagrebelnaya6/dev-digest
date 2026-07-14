import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent } from "@devdigest/shared";
import messages from "../../../../../messages/en/eval.json";
import type { EvalDashboard, EvalRunRecord } from "@/lib/hooks/evals";

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const runAllAgentsMutateAsync = vi.fn().mockResolvedValue({ batches: [] });
const toastSuccess = vi.fn();

let mockAgents: Agent[] = [];
let mockAgentDashboards: Record<string, EvalDashboard> = {};
let mockWorkspaceDashboard: EvalDashboard | undefined;

vi.mock("@/lib/hooks/agents", () => ({
  useAgents: () => ({ data: mockAgents, isLoading: false, isError: false, refetch: vi.fn() }),
}));

vi.mock("@/lib/hooks/evals", async () => {
  const actual = await vi.importActual<typeof import("@/lib/hooks/evals")>("@/lib/hooks/evals");
  return {
    ...actual,
    useAgentEvalDashboard: (agentId: string) => ({
      data: mockAgentDashboards[agentId],
      isLoading: !mockAgentDashboards[agentId],
    }),
    useEvalDashboard: () => ({ data: mockWorkspaceDashboard, isLoading: !mockWorkspaceDashboard }),
    useRunAllAgents: () => ({ mutateAsync: runAllAgentsMutateAsync, isPending: false }),
  };
});

vi.mock("@/lib/toast", () => ({
  useToast: () => ({ success: toastSuccess, error: vi.fn(), info: vi.fn(), toast: vi.fn() }),
}));

import { EvalDashboardView } from "./EvalDashboardView";

afterEach(() => {
  cleanup();
  mockAgents = [];
  mockAgentDashboards = {};
  mockWorkspaceDashboard = undefined;
  runAllAgentsMutateAsync.mockClear();
  toastSuccess.mockClear();
});

function agent(id: string, name: string): Agent {
  return {
    id,
    name,
    description: "",
    provider: "openai",
    model: "gpt-4.1",
    system_prompt: "x",
    output_schema: null,
    strategy: "single-pass",
    ci_fail_on: "critical",
    repo_intel: true,
    enabled: true,
    version: 1,
  };
}

function dashboardWithCases(overrides: Partial<EvalDashboard["current"]> = {}): EvalDashboard {
  return {
    owner_kind: "agent",
    owner_id: "a1",
    cases_total: 5,
    current: { recall: 0.8, precision: 0.9, citation_accuracy: 0.95, traces_passed: 4, traces_total: 5, cost_usd: 0.1, ...overrides },
    delta: { recall: 0.02, precision: -0.01, citation_accuracy: 0.0 },
    trend: [
      { ran_at: "2026-07-10T00:00:00.000Z", recall: 0.78, precision: 0.91, citation_accuracy: 0.95, pass_rate: 0.8, cost_usd: 0.1 },
      { ran_at: "2026-07-12T00:00:00.000Z", recall: 0.8, precision: 0.9, citation_accuracy: 0.95, pass_rate: 0.8, cost_usd: 0.1 },
    ],
    recent_runs: [],
    alert: null,
  };
}

function zeroCaseDashboard(): EvalDashboard {
  return {
    owner_kind: "agent",
    owner_id: "a2",
    cases_total: 0,
    current: { recall: 0, precision: 0, citation_accuracy: 0, traces_passed: 0, traces_total: 0, cost_usd: null },
    delta: { recall: 0, precision: 0, citation_accuracy: 0 },
    trend: [],
    recent_runs: [],
    alert: null,
  };
}

function run(caseId: string, agentId: string, batchId: string, ranAt: string): EvalRunRecord {
  return {
    id: `${batchId}-${caseId}`,
    case_id: caseId,
    case_name: caseId,
    ran_at: ranAt,
    actual_output: { produced_findings: [], meta: { batch_id: batchId, agent_id: agentId, agent_version: 1 } },
    pass: true,
    recall: 0.8,
    precision: 0.9,
    citation_accuracy: 0.95,
    duration_ms: 1000,
    cost_usd: 0.05,
  };
}

function renderWithIntl(ui: React.ReactElement) {
  return render(<NextIntlClientProvider locale="en" messages={{ eval: messages }}>{ui}</NextIntlClientProvider>);
}

describe("EvalDashboardView (AC-15/AC-17)", () => {
  it("renders one row per agent-with-cases; an agent with zero cases shows 'no cases yet', not a crash", () => {
    mockAgents = [agent("a1", "Security Reviewer"), agent("a2", "Custom Mentor")];
    mockAgentDashboards = { a1: dashboardWithCases(), a2: zeroCaseDashboard() };
    mockWorkspaceDashboard = dashboardWithCases();

    renderWithIntl(<EvalDashboardView />);

    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
    expect(screen.getByText("Custom Mentor")).toBeInTheDocument();
    expect(screen.getByText("No cases yet")).toBeInTheDocument();
  });

  it("shows a 'Recent eval runs · all agents' table spanning multiple agents, newest first", () => {
    mockAgents = [agent("a1", "Security Reviewer"), agent("a2", "Performance Reviewer")];
    mockAgentDashboards = { a1: dashboardWithCases(), a2: dashboardWithCases() };
    mockWorkspaceDashboard = {
      ...dashboardWithCases(),
      recent_runs: [
        run("c1", "a1", "batch-old", "2026-07-10T00:00:00.000Z"),
        run("c2", "a2", "batch-new", "2026-07-12T00:00:00.000Z"),
      ],
    };

    renderWithIntl(<EvalDashboardView />);

    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row");
    // header + 2 batch rows, newest (a2/batch-new) first
    expect(rows).toHaveLength(3);
    expect(within(rows[1]!).getByText("Performance Reviewer")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("Security Reviewer")).toBeInTheDocument();
  });
});
