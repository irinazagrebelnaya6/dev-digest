import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../messages/en/prReview.json";
import type { PrRisksRecord } from "@devdigest/shared";

const mutateAsync = vi.fn().mockResolvedValue(undefined);
let mockRisks: PrRisksRecord | null = null;
let mockIsLoading = false;
let mockIsPending = false;

vi.mock("@/lib/hooks/risks", () => ({
  useRisks: () => ({ data: mockRisks, isLoading: mockIsLoading }),
  useComputeRisks: () => ({ mutateAsync, isPending: mockIsPending }),
}));

import { RiskAreasCard } from "./RiskAreasCard";

afterEach(() => {
  cleanup();
  mutateAsync.mockClear();
  mockRisks = null;
  mockIsLoading = false;
  mockIsPending = false;
});

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("RiskAreasCard", () => {
  it("groups risks into severity tabs; default shows the highest severity, clicking a tab switches", () => {
    mockRisks = {
      pr_id: "pr1",
      risks: [
        {
          kind: "auth",
          title: "Missing auth check on new endpoint",
          explanation: "The handler skips the `requireAuth` middleware.",
          severity: "high",
          file_refs: ["src/routes/payments.ts:42"],
        },
        {
          kind: "dependency",
          title: "Unpinned dependency version",
          explanation: "`lodash` is pulled in as a floating range.",
          severity: "medium",
          file_refs: ["package.json:12"],
        },
      ],
    };

    renderWithIntl(<RiskAreasCard prId="pr1" />);

    // One tab per present severity.
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    expect(screen.getByRole("tab", { name: /high/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /medium/i })).toHaveAttribute("aria-selected", "false");

    // Default (highest severity = high): only the high risk's content is shown.
    expect(screen.getByText("Missing auth check on new endpoint")).toBeInTheDocument();
    expect(screen.getByText("requireAuth")).toBeInTheDocument();
    expect(screen.getByText("src/routes/payments.ts:42")).toBeInTheDocument();
    expect(screen.queryByText("Unpinned dependency version")).not.toBeInTheDocument();
    expect(screen.queryByText("lodash")).not.toBeInTheDocument();

    // Switching to the Medium tab reveals only the medium risk.
    fireEvent.click(screen.getByRole("tab", { name: /medium/i }));
    expect(screen.getByText("Unpinned dependency version")).toBeInTheDocument();
    expect(screen.getByText("lodash")).toBeInTheDocument();
    expect(screen.getByText("package.json:12")).toBeInTheDocument();
    expect(screen.queryByText("Missing auth check on new endpoint")).not.toBeInTheDocument();
  });

  it("shows a single tab with all its risks when one severity has several (e.g. 3 medium)", () => {
    mockRisks = {
      pr_id: "pr1",
      risks: [
        { kind: "perf", title: "Risk one", explanation: "Text one.", severity: "medium", file_refs: [] },
        { kind: "data", title: "Risk two", explanation: "Text two.", severity: "medium", file_refs: [] },
        { kind: "other", title: "Risk three", explanation: "Text three.", severity: "medium", file_refs: [] },
      ],
    };

    renderWithIntl(<RiskAreasCard prId="pr1" />);

    // Exactly one severity tab (Medium), and all three risks are listed under it.
    expect(screen.getAllByRole("tab")).toHaveLength(1);
    expect(screen.getByRole("tab", { name: /medium/i })).toBeInTheDocument();
    expect(screen.getByText("Risk one")).toBeInTheDocument();
    expect(screen.getByText("Risk two")).toBeInTheDocument();
    expect(screen.getByText("Risk three")).toBeInTheDocument();
    expect(screen.getByText("Text one.")).toBeInTheDocument();
    expect(screen.getByText("Text three.")).toBeInTheDocument();
  });

  it("renders the empty state when no risk record has been computed", () => {
    mockRisks = null;
    renderWithIntl(<RiskAreasCard prId="pr1" />);

    expect(
      screen.getByText("No risk analysis computed yet — run a review or click Recompute."),
    ).toBeInTheDocument();
  });

  it("renders the no-risks state when a real compute returned an empty risks list", () => {
    mockRisks = { pr_id: "pr1", risks: [] };
    renderWithIntl(<RiskAreasCard prId="pr1" />);

    expect(screen.getByText("No notable risks found in this PR.")).toBeInTheDocument();
  });

  it("fires the compute mutation when Recompute is clicked", () => {
    mockRisks = null;
    renderWithIntl(<RiskAreasCard prId="pr1" />);

    fireEvent.click(screen.getByText("Recompute"));
    expect(mutateAsync).toHaveBeenCalledTimes(1);
  });
});
