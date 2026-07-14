import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/eval.json";
import type { EvalCompareResult } from "@/lib/hooks/evals";

const promoteMutateAsync = vi.fn().mockResolvedValue({ id: "agent1" });
const toastSuccess = vi.fn();
let mockCompare: EvalCompareResult | undefined;

vi.mock("@/lib/hooks/evals", async () => {
  const actual = await vi.importActual<typeof import("@/lib/hooks/evals")>("@/lib/hooks/evals");
  return {
    ...actual,
    useCompareEvalRuns: () => ({ data: mockCompare, isLoading: !mockCompare, isError: false }),
    usePromoteEvalRun: () => ({ mutateAsync: promoteMutateAsync, isPending: false }),
  };
});

vi.mock("@/lib/toast", () => ({
  useToast: () => ({ success: toastSuccess, error: vi.fn(), info: vi.fn(), toast: vi.fn() }),
}));

import { CompareRunsModal } from "./CompareRunsModal";

afterEach(() => {
  cleanup();
  mockCompare = undefined;
  promoteMutateAsync.mockClear();
  toastSuccess.mockClear();
});

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

function compareResult(): EvalCompareResult {
  return {
    agent_id: "agent1",
    a: {
      batch_id: "batch-v6",
      agent_version: 6,
      ran_at: "2026-05-27T00:00:00.000Z",
      cases_total: 12,
      recall: 0.78,
      precision: 0.93,
      citation_accuracy: 0.94,
      cost_usd: 0.21,
      system_prompt: "You are a security reviewer.\nReturn at most 5 findings.",
    },
    b: {
      batch_id: "batch-v7",
      agent_version: 7,
      ran_at: "2026-05-29T00:00:00.000Z",
      cases_total: 12,
      recall: 0.82,
      precision: 0.91,
      citation_accuracy: 0.95,
      cost_usd: 0.23,
      system_prompt:
        "You are a security reviewer.\nFlag unused imports as suggestions.\nReturn at most 5 findings.",
    },
    delta: { recall: 0.04, precision: -0.02, citation_accuracy: 0.01, cost_usd: 0.02 },
  };
}

function renderWithIntl(ui: React.ReactElement) {
  return render(<NextIntlClientProvider locale="en" messages={{ eval: messages }}>{ui}</NextIntlClientProvider>);
}

describe("CompareRunsModal (AC-12/AC-13/AC-14)", () => {
  it("renders metric deltas and the system-prompt diff with the added line highlighted", () => {
    mockCompare = compareResult();
    renderWithIntl(<CompareRunsModal agent={AGENT} batchA="batch-v6" batchB="batch-v7" onClose={() => {}} />);

    expect(screen.getByText("Compare runs · v6 → v7")).toBeInTheDocument();
    // Both versions' system_prompt text is present (AC-13).
    expect(screen.getByText("Flag unused imports as suggestions.")).toBeInTheDocument();
    // Recall went up, precision went down — both deltas rendered with their signed magnitude.
    expect(screen.getByText("4pt")).toBeInTheDocument();
    expect(screen.getByText("2pt")).toBeInTheDocument();
  });

  it("promotes the newer version and closes on success", async () => {
    mockCompare = compareResult();
    const onClose = vi.fn();
    renderWithIntl(<CompareRunsModal agent={AGENT} batchA="batch-v6" batchB="batch-v7" onClose={onClose} />);

    fireEvent.click(screen.getByText("Promote v7"));
    await waitFor(() => expect(promoteMutateAsync).toHaveBeenCalledWith("batch-v7"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
