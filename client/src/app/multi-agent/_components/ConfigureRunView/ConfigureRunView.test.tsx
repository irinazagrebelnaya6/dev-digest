import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, PrMeta } from "@devdigest/shared";
import messages from "../../../../../messages/en/multiAgent.json";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ repoId: "repo1", activeRepo: null, repos: [], setRepoId: vi.fn(), reposLoaded: true }),
}));

let mockPulls: Partial<PrMeta>[] = [{ id: "pr1", number: 482, title: "Add rate limiting" }];
vi.mock("@/lib/hooks", () => ({
  usePulls: () => ({ data: mockPulls }),
}));

let mockAgents: Partial<Agent>[] = [
  { id: "a1", name: "Security", description: "Security review", enabled: true },
  { id: "a2", name: "Performance", description: "Perf review", enabled: true },
];
vi.mock("@/lib/hooks/agents", () => ({
  useAgents: () => ({ data: mockAgents, isLoading: false }),
}));

const mutateAsync = vi.fn().mockResolvedValue({ multi_agent_run_id: "run-1" });
vi.mock("@/lib/hooks/reviews", () => ({
  useRunReview: () => ({ mutateAsync, isPending: false }),
}));

let mockEstimate:
  | { per_agent: { agent_id: string; agent_name: string; est_time_ms: number | null; est_cost_usd: number | null; confidence: "exact" | "approx" | "none" }[]; summary_time_ms: number; summary_cost_usd: number }
  | undefined;
vi.mock("@/lib/hooks/multi-agent", async () => {
  const actual = await vi.importActual<typeof import("@/lib/hooks/multi-agent")>("@/lib/hooks/multi-agent");
  return {
    ...actual,
    useAgentEstimates: () => ({ data: mockEstimate }),
  };
});

import { ConfigureRunView } from "./ConfigureRunView";

afterEach(() => {
  cleanup();
  mockPulls = [{ id: "pr1", number: 482, title: "Add rate limiting" }];
  mockAgents = [
    { id: "a1", name: "Security", description: "Security review", enabled: true },
    { id: "a2", name: "Performance", description: "Perf review", enabled: true },
  ];
  mockEstimate = undefined;
  mutateAsync.mockClear();
});

function renderWithIntl() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ multiAgent: messages }}>
      <ConfigureRunView />
    </NextIntlClientProvider>,
  );
}

describe("ConfigureRunView (SPEC-06 Configure run)", () => {
  it("AC-4: while no PR is selected, shows the empty state and no agent checkboxes", () => {
    renderWithIntl();
    expect(screen.getByText("Pick a pull request first")).toBeInTheDocument();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });

  it("AC-5: selecting a PR lists every agent as a checkbox row", () => {
    mockEstimate = {
      per_agent: [
        { agent_id: "a1", agent_name: "Security", est_time_ms: 8200, est_cost_usd: 0.06, confidence: "exact" },
        { agent_id: "a2", agent_name: "Performance", est_time_ms: 7400, est_cost_usd: 0.05, confidence: "exact" },
      ],
      summary_time_ms: 8200,
      summary_cost_usd: 0.11,
    };
    renderWithIntl();
    fireEvent.click(screen.getByText("Select a pull request…"));
    fireEvent.click(screen.getByText("#482 · Add rate limiting"));
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    expect(screen.getByText("8.2s · $0.06")).toBeInTheDocument();
    expect(screen.getByText("7.4s · $0.05")).toBeInTheDocument();
  });

  it("AC-7: an agent with no run history renders the low-confidence fallback marker", () => {
    mockEstimate = {
      per_agent: [
        { agent_id: "a1", agent_name: "Security", est_time_ms: 8200, est_cost_usd: 0.06, confidence: "approx" },
        { agent_id: "a2", agent_name: "Performance", est_time_ms: null, est_cost_usd: null, confidence: "none" },
      ],
      summary_time_ms: 0,
      summary_cost_usd: 0,
    };
    renderWithIntl();
    fireEvent.click(screen.getByText("Select a pull request…"));
    fireEvent.click(screen.getByText("#482 · Add rate limiting"));
    expect(screen.getByText("~8.2s · $0.06")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("AC-6: the summary estimate is MAX(time) / SUM(cost) over the selected set only", () => {
    mockEstimate = {
      per_agent: [
        { agent_id: "a1", agent_name: "Security", est_time_ms: 8200, est_cost_usd: 0.06, confidence: "exact" },
        { agent_id: "a2", agent_name: "Performance", est_time_ms: 7400, est_cost_usd: 0.05, confidence: "exact" },
      ],
      summary_time_ms: 8200,
      summary_cost_usd: 0.11,
    };
    renderWithIntl();
    fireEvent.click(screen.getByText("Select a pull request…"));
    fireEvent.click(screen.getByText("#482 · Add rate limiting"));
    // Both agents checked by default? No — Configure run starts unchecked; check both.
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]!);
    fireEvent.click(checkboxes[1]!);
    expect(screen.getByText("≈ 8.2s · $0.11 · parallel fan-out")).toBeInTheDocument();

    // Uncheck the slower agent — summary should now be Performance-only.
    fireEvent.click(checkboxes[0]!);
    expect(screen.getByText("≈ 7.4s · $0.05 · parallel fan-out")).toBeInTheDocument();
  });

  it("disables the run button at N=0 even with a PR selected", () => {
    renderWithIntl();
    fireEvent.click(screen.getByText("Select a pull request…"));
    fireEvent.click(screen.getByText("#482 · Add rate limiting"));
    const runButton = screen.getByText("Run multi-agent review (0)").closest("button");
    expect(runButton).toBeDisabled();
  });
});
