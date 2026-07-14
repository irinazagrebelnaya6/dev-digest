import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/eval.json";
import type { EvalCaseRecord, EvalRunRecord } from "@/lib/hooks/evals";

const runAllMutateAsync = vi.fn().mockResolvedValue({ batch_id: "b1", runs: [] });
const runOneMutateAsync = vi.fn().mockResolvedValue({ run_id: "r1", case_id: "c1", result: {} });
const deleteMutateAsync = vi.fn().mockResolvedValue({ ok: true });
const toastSuccess = vi.fn();

let mockCases: EvalCaseRecord[] = [];
let mockRuns: EvalRunRecord[] = [];

vi.mock("@/lib/hooks/evals", async () => {
  const actual = await vi.importActual<typeof import("@/lib/hooks/evals")>("@/lib/hooks/evals");
  return {
    ...actual,
    useAgentEvalCases: () => ({ data: mockCases, isLoading: false, isError: false, refetch: vi.fn() }),
    useAgentEvalRuns: () => ({ data: mockRuns }),
    useAgentEvalDashboard: () => ({ data: undefined }),
    useRunAgentEvalCases: () => ({ mutateAsync: runAllMutateAsync, isPending: false }),
    useRunEvalCase: () => ({ mutateAsync: runOneMutateAsync, isPending: false }),
    useDeleteEvalCase: () => ({ mutateAsync: deleteMutateAsync, isPending: false }),
    useCreateEvalCase: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useUpdateEvalCase: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useEvalCase: () => ({ data: undefined, isLoading: false }),
  };
});

vi.mock("@/lib/toast", () => ({
  useToast: () => ({ success: toastSuccess, error: vi.fn(), info: vi.fn(), toast: vi.fn() }),
}));

import { EvalsTab } from "./EvalsTab";

afterEach(() => {
  cleanup();
  runAllMutateAsync.mockClear();
  runOneMutateAsync.mockClear();
  deleteMutateAsync.mockClear();
  toastSuccess.mockClear();
  mockCases = [];
  mockRuns = [];
});

const AGENT: Agent = {
  id: "agent1",
  name: "Security Reviewer",
  description: "Flags secrets",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "You are a security reviewer.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 3,
};

function passedCase(id: string): EvalCaseRecord {
  return {
    id,
    owner_kind: "agent",
    owner_id: AGENT.id,
    name: "stripe-key-leak",
    input_diff: "--- a/src/config.ts\n+++ b/src/config.ts\n@@ -1,1 +1,2 @@\n+  stripeKey: 'x'",
    input_files: null,
    input_meta: { severity: "CRITICAL", category: "security" },
    expected_output: { type: "must_find", file: "src/config.ts", start_line: 12, end_line: 12 },
    notes: null,
  };
}

function passedRun(caseId: string, pass: boolean | null): EvalRunRecord {
  return {
    id: `run-${caseId}`,
    case_id: caseId,
    case_name: "stripe-key-leak",
    ran_at: "2026-07-14T00:00:00.000Z",
    actual_output: { produced_findings: [{ file: "src/config.ts", start_line: 12, end_line: 12 }] },
    pass,
    recall: 1,
    precision: 1,
    citation_accuracy: 1,
    duration_ms: 1200,
    cost_usd: 0.01,
  };
}

function renderWithIntl(ui: React.ReactElement) {
  return render(<NextIntlClientProvider locale="en" messages={{ eval: messages }}>{ui}</NextIntlClientProvider>);
}

describe("EvalsTab (AC-19)", () => {
  it("shows the empty state when the agent has no eval cases", () => {
    mockCases = [];
    renderWithIntl(<EvalsTab agent={AGENT} />);
    expect(screen.getByText(/No eval cases yet/)).toBeInTheDocument();
  });

  it("renders pass state via icon + text label, never color alone", () => {
    mockCases = [passedCase("c1")];
    mockRuns = [passedRun("c1", true)];
    renderWithIntl(<EvalsTab agent={AGENT} />);
    expect(screen.getByText("stripe-key-leak")).toBeInTheDocument();
    // Text label accompanies the icon — this is the a11y assertion (color alone
    // is never sufficient), mirroring PrBriefCard's risk_level convention.
    expect(screen.getByText("passed")).toBeInTheDocument();
    expect(screen.getByText("Critical")).toBeInTheDocument();
    expect(screen.getByText("security")).toBeInTheDocument();
  });

  it("renders fail state distinctly from pass, with its own icon + text", () => {
    mockCases = [passedCase("c1")];
    mockRuns = [passedRun("c1", false)];
    renderWithIntl(<EvalsTab agent={AGENT} />);
    expect(screen.getByText("failed")).toBeInTheDocument();
  });

  it("renders 'never run' for a case with no run history yet", () => {
    mockCases = [passedCase("c1")];
    mockRuns = [];
    renderWithIntl(<EvalsTab agent={AGENT} />);
    expect(screen.getByText("never run")).toBeInTheDocument();
  });

  it("shows the N/M passing count and fires run-all", async () => {
    mockCases = [passedCase("c1"), passedCase("c2")];
    mockRuns = [passedRun("c1", true), passedRun("c2", false)];
    renderWithIntl(<EvalsTab agent={AGENT} />);
    expect(screen.getByText("1/2 passing")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Run all evals"));
    expect(runAllMutateAsync).toHaveBeenCalledTimes(1);
  });

  it("asks for inline confirmation before deleting a case (no window.confirm)", async () => {
    mockCases = [passedCase("c1")];
    mockRuns = [];
    renderWithIntl(<EvalsTab agent={AGENT} />);
    fireEvent.click(screen.getByLabelText("Delete"));
    expect(screen.getByText("Delete?")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Delete", { selector: "button" }));
    await waitFor(() =>
      expect(deleteMutateAsync).toHaveBeenCalledWith({ id: "c1", agentId: "agent1" }),
    );
  });
});
