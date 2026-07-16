import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent } from "@devdigest/shared";
import ciMessages from "../../../../../messages/en/ci.json";
import type { CiRunRecord } from "@/lib/hooks/useCi";

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const mocks = vi.hoisted(() => ({
  runs: [] as CiRunRecord[],
  isLoading: false,
  isError: false,
  lastFilters: undefined as unknown,
}));

vi.mock("@/lib/hooks/useCi", () => ({
  useWorkspaceCiRuns: (filters: unknown) => {
    mocks.lastFilters = filters;
    return { data: mocks.runs, isLoading: mocks.isLoading, isError: mocks.isError, refetch: vi.fn() };
  },
}));

let mockAgents: Agent[] = [];
vi.mock("@/lib/hooks/agents", () => ({
  useAgents: () => ({ data: mockAgents }),
}));

import { CiRunsPage } from "./CiRunsPage";

function renderPage() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ ci: ciMessages }}>
      <CiRunsPage />
    </NextIntlClientProvider>,
  );
}

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

function run(overrides: Partial<CiRunRecord> = {}): CiRunRecord {
  return {
    id: "run-1",
    ci_installation_id: "inst-1",
    pr_number: 42,
    ran_at: "2026-07-05T12:00:00.000Z",
    status: "succeeded",
    findings_count: 3,
    cost_usd: 0.02,
    github_url: "https://github.com/acme/payments-api/actions/runs/1",
    source: "ci",
    repo: "acme/payments-api",
    agent: "Security Reviewer",
    duration_s: 45,
    ...overrides,
  };
}

beforeEach(() => {
  mocks.runs = [];
  mocks.isLoading = false;
  mocks.isError = false;
  mocks.lastFilters = undefined;
  mockAgents = [];
});

afterEach(cleanup);

describe("CiRunsPage (AC-12)", () => {
  it("renders the empty state when there are no CI runs", () => {
    renderPage();
    expect(screen.getByText("No CI runs yet")).toBeInTheDocument();
  });

  it("renders the runs table with fixtures (Repository · Agent · Status · Findings · Cost · Duration · Job)", () => {
    mocks.runs = [run()];
    renderPage();

    expect(screen.getByText("acme/payments-api")).toBeInTheDocument();
    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
    expect(screen.getByText("Succeeded")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("45s")).toBeInTheDocument();
    expect(screen.getByText("View")).toBeInTheDocument();
  });

  it("updates the query filters when typing a repository filter", () => {
    mockAgents = [agent("a1", "Security Reviewer")];
    renderPage();

    fireEvent.change(screen.getByPlaceholderText("Filter by repository…"), { target: { value: "acme/payments-api" } });
    expect(mocks.lastFilters).toEqual(expect.objectContaining({ repo: "acme/payments-api" }));
  });

  it("updates the query filters when selecting an agent", () => {
    mockAgents = [agent("a1", "Security Reviewer")];
    renderPage();

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "a1" } });
    expect(mocks.lastFilters).toEqual(expect.objectContaining({ agent_id: "a1" }));
  });

  it("shows an error state with retry on load failure", () => {
    mocks.isError = true;
    renderPage();
    expect(screen.getByText("Could not load CI runs.")).toBeInTheDocument();
  });
});
