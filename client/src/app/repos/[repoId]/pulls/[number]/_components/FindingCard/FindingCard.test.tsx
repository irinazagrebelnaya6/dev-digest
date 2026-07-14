import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";

const createEvalCaseMutateAsync = vi.fn().mockResolvedValue({ id: "case1", owner_id: "agent1" });

vi.mock("@/lib/hooks/evals", () => ({
  useCreateEvalCaseFromFinding: () => ({ mutateAsync: createEvalCaseMutateAsync, isPending: false }),
}));

const toastSuccess = vi.fn();
vi.mock("@/lib/toast", () => ({
  useToast: () => ({ success: toastSuccess, error: vi.fn(), info: vi.fn(), toast: vi.fn() }),
}));

import { FindingCard } from "./FindingCard";

afterEach(() => {
  cleanup();
  createEvalCaseMutateAsync.mockClear();
  toastSuccess.mockClear();
});

const FINDING: FindingRecord = {
  id: "f1",
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded Stripe secret key",
  file: "src/config.ts",
  start_line: 11,
  end_line: 11,
  rationale: "A **live** Stripe key is committed in source.",
  suggestion: "Move the key to an environment variable.",
  confidence: 0.95,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "r1",
  accepted_at: null,
  dismissed_at: null,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("FindingCard (smoke, both themes)", () => {
  (["dark", "light"] as const).forEach((theme) => {
    it(`renders severity + file:line + rationale in ${theme}`, () => {
      renderWithIntl(
        <div data-theme={theme}>
          <FindingCard f={FINDING} defaultExpanded onAction={() => {}} />
        </div>,
      );
      expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
      expect(screen.getByText("src/config.ts:11")).toBeInTheDocument();
      // category label is shown alongside the severity badge
      expect(screen.getByText("security")).toBeInTheDocument();
    });
  });

  it("fires accept/dismiss actions", () => {
    const onAction = vi.fn();
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded onAction={onAction} />);
    fireEvent.click(screen.getByText("Accept"));
    expect(onAction).toHaveBeenCalledWith("accept");
    fireEvent.click(screen.getByText("Dismiss"));
    expect(onAction).toHaveBeenCalledWith("dismiss");
  });

  // AC-4: "Turn into eval case" is only available once a finding has been
  // accepted or dismissed (a pending finding has no frozen expectation yet).
  describe("Turn into eval case (AC-2/3/4)", () => {
    it("is not rendered for a pending finding (neither accepted_at nor dismissed_at set)", () => {
      renderWithIntl(<FindingCard f={FINDING} defaultExpanded onAction={() => {}} />);
      expect(screen.queryByText("Turn into eval case")).not.toBeInTheDocument();
    });

    it("is rendered and enabled for an accepted finding", () => {
      const accepted: FindingRecord = { ...FINDING, accepted_at: "2026-07-14T00:00:00.000Z" };
      renderWithIntl(<FindingCard f={accepted} defaultExpanded onAction={() => {}} />);
      const btn = screen.getByText("Turn into eval case").closest("button");
      expect(btn).toBeInTheDocument();
      expect(btn).not.toBeDisabled();
    });

    it("is rendered and enabled for a dismissed finding", () => {
      const dismissed: FindingRecord = { ...FINDING, dismissed_at: "2026-07-14T00:00:00.000Z" };
      renderWithIntl(<FindingCard f={dismissed} defaultExpanded onAction={() => {}} />);
      const btn = screen.getByText("Turn into eval case").closest("button");
      expect(btn).toBeInTheDocument();
      expect(btn).not.toBeDisabled();
    });

    it("calls the create-eval-case mutation and shows a success toast on click", async () => {
      const accepted: FindingRecord = { ...FINDING, accepted_at: "2026-07-14T00:00:00.000Z" };
      renderWithIntl(<FindingCard f={accepted} defaultExpanded onAction={() => {}} />);
      fireEvent.click(screen.getByText("Turn into eval case"));
      expect(createEvalCaseMutateAsync).toHaveBeenCalledWith("f1");
      await vi.waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Eval case created"));
    });
  });
});
