import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, CiInstallation } from "@devdigest/shared";
import agentsMessages from "../../../../../../../../messages/en/agents.json";
import ciMessages from "../../../../../../../../messages/en/ci.json";
import type { CiRunRecord } from "@/lib/hooks/useCi";

const mocks = vi.hoisted(() => ({
  updateFailOnMutate: vi.fn(),
  installations: [] as CiInstallation[],
  installationsLoading: false,
  installationsError: false,
  runs: [] as CiRunRecord[],
}));

vi.mock("@/lib/hooks/useCi", () => ({
  useAgentCiInstallations: () => ({
    data: mocks.installations,
    isLoading: mocks.installationsLoading,
    isError: mocks.installationsError,
    refetch: vi.fn(),
  }),
  useAgentCiRuns: () => ({ data: mocks.runs }),
  useUpdateCiFailOn: () => ({ mutate: mocks.updateFailOnMutate, isPending: false }),
}));

// The wizard has its own test suite covering its internals — here we only
// assert it opens/closes.
vi.mock("../ExportWizard", () => ({
  ExportWizard: ({ onClose }: { onClose: () => void }) => (
    <div role="dialog" aria-modal="true">
      Export Wizard
      <button onClick={onClose}>close</button>
    </div>
  ),
}));

import { CiTab } from "./CiTab";

afterEach(cleanup);

const AGENT: Agent = {
  id: "agent-1",
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
  version: 1,
};

const INSTALLATION: CiInstallation = {
  id: "inst-1",
  agent_id: "agent-1",
  repo: "acme/payments-api",
  target_type: "gha",
  installed_at: "2026-07-01T00:00:00.000Z",
};

const RUN: CiRunRecord = {
  id: "run-1",
  ci_installation_id: "inst-1",
  pr_number: 42,
  ran_at: "2026-07-05T12:00:00.000Z",
  status: "succeeded",
  findings_count: 2,
  cost_usd: 0.01,
  github_url: "https://github.com/acme/payments-api/actions/runs/1",
  source: "ci",
};

function renderCiTab(agent: Agent = AGENT) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: agentsMessages, ci: ciMessages }}>
      <CiTab agent={agent} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  mocks.updateFailOnMutate.mockReset();
  mocks.installations = [];
  mocks.installationsLoading = false;
  mocks.installationsError = false;
  mocks.runs = [];
});

describe("CiTab", () => {
  it("shows the empty state with an '+ Add repository' CTA when there are no installations", () => {
    renderCiTab();
    expect(screen.getByText("Not deployed to CI yet.")).toBeInTheDocument();
    expect(screen.getAllByText("+ Add repository").length).toBeGreaterThan(0);
  });

  it("renders the installations table (Repository · Platform · Status · Last run) (AC-10)", () => {
    mocks.installations = [INSTALLATION];
    mocks.runs = [RUN];
    renderCiTab();

    expect(screen.getByText("acme/payments-api")).toBeInTheDocument();
    expect(screen.getByText("GitHub Actions")).toBeInTheDocument();
    expect(screen.getByText("Succeeded")).toBeInTheDocument();
  });

  it("clicking '+ Add repository' opens the Export Wizard (AC-1)", () => {
    renderCiTab();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const [addButton] = screen.getAllByText("+ Add repository");
    fireEvent.click(addButton!.closest("button")!);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("changing 'Fail CI on' for a row fires the update mutation (AC-13)", () => {
    mocks.installations = [INSTALLATION];
    renderCiTab();

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "any" } });
    expect(mocks.updateFailOnMutate).toHaveBeenCalledWith("any");
  });
});
