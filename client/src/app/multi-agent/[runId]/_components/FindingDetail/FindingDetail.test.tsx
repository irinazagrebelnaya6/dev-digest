import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import prReviewMessages from "../../../../../../messages/en/prReview.json";
import multiAgentMessages from "../../../../../../messages/en/multiAgent.json";

const mutateAsync = vi.fn().mockResolvedValue({ finding: {} });
vi.mock("@/lib/hooks/reviews", () => ({
  useFindingAction: () => ({ mutateAsync, isPending: false }),
}));

const createEvalCaseMutateAsync = vi.fn().mockResolvedValue({ owner_id: "a1" });
vi.mock("@/lib/hooks/evals", () => ({
  useCreateEvalCaseFromFinding: () => ({ mutateAsync: createEvalCaseMutateAsync, isPending: false }),
}));

const toastSuccess = vi.fn();
vi.mock("@/lib/toast", () => ({
  useToast: () => ({ success: toastSuccess, error: vi.fn(), info: vi.fn(), toast: vi.fn() }),
}));

import { FindingDetail } from "./FindingDetail";

afterEach(() => {
  cleanup();
  mutateAsync.mockClear();
  createEvalCaseMutateAsync.mockClear();
  toastSuccess.mockClear();
});

function baseFinding(overrides: Partial<FindingRecord> = {}): FindingRecord {
  return {
    id: "f1",
    severity: "CRITICAL",
    category: "security",
    title: "Hardcoded Stripe secret key in commit",
    file: "src/config.ts",
    start_line: 12,
    end_line: 12,
    rationale: "Line 12 contains a literal Stripe secret key.",
    suggestion: "Move the key to an environment variable.",
    confidence: 0.98,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
    ...overrides,
  };
}

function renderDetail(finding: FindingRecord, defaultExpanded = true) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: prReviewMessages, multiAgent: multiAgentMessages }}>
      <FindingDetail finding={finding} prId="pr1" defaultExpanded={defaultExpanded} />
    </NextIntlClientProvider>,
  );
}

describe("FindingDetail (SPEC-06 AC-16)", () => {
  it("shows confidence, category, rationale, suggested fix, and all five action buttons", () => {
    renderDetail(baseFinding());
    expect(screen.getByText("Hardcoded Stripe secret key in commit")).toBeInTheDocument();
    expect(screen.getByText("98% conf")).toBeInTheDocument();
    expect(screen.getByText("Line 12 contains a literal Stripe secret key.")).toBeInTheDocument();
    expect(screen.getByText("Suggested fix")).toBeInTheDocument();
    expect(screen.getByText("Move the key to an environment variable.")).toBeInTheDocument();

    expect(screen.getByText("Accept")).toBeInTheDocument();
    expect(screen.getByText("Dismiss")).toBeInTheDocument();
    expect(screen.getByText("Learn")).toBeInTheDocument();
    expect(screen.getByText("Turn into eval case")).toBeInTheDocument();
    expect(screen.getByText("Reply to author")).toBeInTheDocument();
  });

  it("Turn into eval case is disabled until the finding is accepted or dismissed", () => {
    renderDetail(baseFinding());
    expect(screen.getByText("Turn into eval case").closest("button")).toBeDisabled();
  });

  it("Turn into eval case is enabled once accepted", () => {
    renderDetail(baseFinding({ accepted_at: "2026-01-01T00:00:00Z" }));
    expect(screen.getByText("Turn into eval case").closest("button")).not.toBeDisabled();
  });

  it("Learn fires the learn finding action", async () => {
    renderDetail(baseFinding());
    await act(async () => {
      fireEvent.click(screen.getByText("Learn"));
      await Promise.resolve();
    });
    expect(mutateAsync).toHaveBeenCalledWith({ findingId: "f1", action: "learn", reply: undefined, prId: "pr1" });
  });

  it("Reply to author opens a modal and posts the reply body", async () => {
    renderDetail(baseFinding());
    fireEvent.click(screen.getByText("Reply to author"));
    const textarea = screen.getByPlaceholderText("Reply to the author about this finding…");
    fireEvent.change(textarea, { target: { value: "Thanks, fixing now." } });
    await act(async () => {
      fireEvent.click(screen.getByText("Send reply"));
      await Promise.resolve();
    });
    expect(mutateAsync).toHaveBeenCalledWith({
      findingId: "f1",
      action: "reply",
      reply: "Thanks, fixing now.",
      prId: "pr1",
    });
  });
});
