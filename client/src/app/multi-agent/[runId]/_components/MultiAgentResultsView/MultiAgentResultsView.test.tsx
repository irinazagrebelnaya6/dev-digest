import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MultiAgentRun } from "@devdigest/shared";
import multiAgentMessages from "../../../../../../messages/en/multiAgent.json";

const push = vi.fn();
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

let mockRun: MultiAgentRun | undefined;
vi.mock("@/lib/hooks/multi-agent", async () => {
  const actual = await vi.importActual<typeof import("@/lib/hooks/multi-agent")>("@/lib/hooks/multi-agent");
  return {
    ...actual,
    useMultiAgentRun: () => ({ data: mockRun, isLoading: false, isError: false, refetch: vi.fn() }),
    useMultiAgentEconomics: () => ({ data: undefined }),
  };
});

vi.mock("@/lib/hooks/reviews", () => ({
  usePrReviews: () => ({ data: [] }),
  useRunEvents: () => ({ events: [], running: false }),
}));

import { MultiAgentResultsView } from "./MultiAgentResultsView";

afterEach(() => {
  cleanup();
  mockRun = undefined;
  push.mockClear();
  replace.mockClear();
});

function run(): MultiAgentRun {
  return {
    id: "run-1",
    pr_id: "pr1",
    pr_number: 482,
    ran_at: "2026-01-01T00:00:00Z",
    agent_count: 2,
    total_duration_ms: 8200,
    total_cost_usd: 0.11,
    status: "running",
    columns: [
      {
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
        findings: [],
      },
      {
        run_id: "run-a2",
        agent_id: "a2",
        agent_name: "Performance",
        provider: "openai",
        model: "gpt-4.1",
        status: "running",
        verdict: null,
        score: null,
        summary: null,
        duration_ms: null,
        cost_usd: null,
        findings: [],
      },
    ],
    conflicts: [],
  };
}

function renderView() {
  mockRun = run();
  const qc = new QueryClient();
  render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ multiAgent: multiAgentMessages }}>
        <MultiAgentResultsView runId="run-1" />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("MultiAgentResultsView (SPEC-06 AC-13)", () => {
  it("defaults to Columns mode and switches to Tabs mode via the toggle", () => {
    renderView();
    expect(screen.getByText("Security")).toBeInTheDocument();
    expect(screen.getByText("Performance")).toBeInTheDocument();
    // Columns mode renders both agent lanes at once as sibling cards.
    expect(screen.getAllByText("View trace")).toHaveLength(2);

    fireEvent.click(screen.getByText("Tabs"));
    // Tabs mode renders one tab bar with both agent names as tab labels, and a
    // single "View trace" for the active tab's own summary card (not one per
    // agent like Columns mode).
    expect(screen.getAllByText("View trace")).toHaveLength(1);
  });

  it("shows the fan-out summary with agent count, time and cost", () => {
    renderView();
    expect(screen.getByText("2 agents · fan-out via worktrees · 8.2s total · $0.11")).toBeInTheDocument();
  });

  it("surfaces the overall multi-run status as an icon + text label near the summary line", () => {
    renderView();
    // The fixture's `status: "running"` — text label present (not color alone).
    expect(screen.getByTestId("run-status")).toHaveTextContent("Running");
  });
});
