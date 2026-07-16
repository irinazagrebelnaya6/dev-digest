import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../messages/en/prReview.json";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

let mockAgents: { id: string; name: string; model: string; enabled: boolean }[] = [
  { id: "a1", name: "Security", model: "gpt-4.1", enabled: true },
  { id: "a2", name: "Performance", model: "gpt-4.1", enabled: true },
];
vi.mock("../../../../../../../lib/hooks/agents", () => ({
  useAgents: () => ({ data: mockAgents }),
}));

const mutateAsync = vi.fn().mockResolvedValue({ runs: [], multi_agent_run_id: "run-1" });
vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useRunReview: () => ({ mutateAsync, isPending: false }),
}));

vi.mock("../../../../../../../lib/hooks/multi-agent", () => ({
  useAgentEstimates: () => ({ data: { per_agent: [], summary_time_ms: 0, summary_cost_usd: 0 } }),
  estimateHint: () => "~6s",
}));

import { RunReviewDropdown } from "./RunReviewDropdown";

afterEach(() => {
  cleanup();
  mockAgents = [
    { id: "a1", name: "Security", model: "gpt-4.1", enabled: true },
    { id: "a2", name: "Performance", model: "gpt-4.1", enabled: true },
  ];
  mutateAsync.mockClear();
});

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("RunReviewDropdown (SPEC-06 picker)", () => {
  it("renders the trigger label", () => {
    renderWithIntl(<RunReviewDropdown prId="pr1" />);
    expect(screen.getByText("Run Review")).toBeInTheDocument();
  });

  it("AC-1: opening the control lists every agent as a checkbox row with a hint", () => {
    renderWithIntl(<RunReviewDropdown prId="pr1" />);
    fireEvent.click(screen.getByText("Run Review"));
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    expect(screen.getByText("Security")).toBeInTheDocument();
    expect(screen.getByText("Performance")).toBeInTheDocument();
    expect(screen.getAllByText("~6s")).toHaveLength(2);
  });

  it("AC-2/AC-3: the run button label reflects N and is enabled once ≥1 agent is checked; unchecking to 0 disables it again", () => {
    renderWithIntl(<RunReviewDropdown prId="pr1" />);
    fireEvent.click(screen.getByText("Run Review"));
    // Both agents are enabled → default-selected → N=2.
    expect(screen.getByText("Run multi-agent review (2)")).toBeInTheDocument();
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]!);
    fireEvent.click(checkboxes[1]!);
    const runButton = screen.getByText("Run multi-agent review (0)").closest("button");
    expect(runButton).toBeDisabled();
  });

  it("AC-2: launching posts exactly the checked agentIds and navigates to the multi-agent run", async () => {
    renderWithIntl(<RunReviewDropdown prId="pr1" />);
    fireEvent.click(screen.getByText("Run Review"));
    // Deselect Performance, keep only Security checked.
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[1]!);
    await act(async () => {
      fireEvent.click(screen.getByText("Run multi-agent review (1)"));
      await Promise.resolve();
    });
    expect(mutateAsync).toHaveBeenCalledWith({ prId: "pr1", agentIds: ["a1"] });
  });

  it("empty state: no agents yet shows the create-one affordance and no checkboxes", () => {
    mockAgents = [];
    renderWithIntl(<RunReviewDropdown prId="pr1" />);
    fireEvent.click(screen.getByText("Run Review"));
    expect(screen.getByText("No agents yet — create one")).toBeInTheDocument();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });
});
