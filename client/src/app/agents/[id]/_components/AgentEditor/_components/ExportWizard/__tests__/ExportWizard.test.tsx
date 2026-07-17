import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import agentsMessages from "../../../../../../../../../messages/en/agents.json";
import ciMessages from "../../../../../../../../../messages/en/ci.json";
import type { CiExport, CiFile } from "@devdigest/shared";

const FILES: CiFile[] = [
  { path: ".devdigest/agents/security-reviewer.yaml", contents: "name: Security Reviewer\n", editable: false },
  { path: ".devdigest/memory.jsonl", contents: "", editable: false },
  {
    path: ".github/workflows/devdigest-review.yml",
    contents: "permissions:\n  contents: read\n  pull-requests: write\nname: DevDigest Review\n",
    editable: true,
  },
];

const mocks = vi.hoisted(() => ({
  exportMutateAsync: vi.fn(),
  exportIsPending: false,
  updateAgentMutateAsync: vi.fn(),
}));

vi.mock("@/lib/hooks/useCi", () => ({
  useExportCi: () => ({ mutateAsync: mocks.exportMutateAsync, isPending: mocks.exportIsPending }),
}));

vi.mock("@/lib/hooks/agents", () => ({
  useUpdateAgent: () => ({ mutateAsync: mocks.updateAgentMutateAsync, isPending: false }),
}));

vi.mock("@/lib/hooks/core", () => ({
  useSecretsStatus: () => ({ data: { openai: true, anthropic: false, openrouter: true, github: true }, isLoading: false }),
}));

import { ExportWizard } from "../ExportWizard";

function renderWizard(onClose = vi.fn()) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: agentsMessages, ci: ciMessages }}>
      <ExportWizard agentId="agent-1" agentName="Security Reviewer" ciFailOnDefault="critical" onClose={onClose} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  mocks.exportMutateAsync.mockReset();
  mocks.exportIsPending = false;
  mocks.updateAgentMutateAsync.mockReset();
  mocks.exportMutateAsync.mockResolvedValue({
    installation: { id: "inst-1", agent_id: "agent-1", repo: "acme/payments-api", target_type: "gha", installed_at: "now" },
    files: FILES,
    pr_url: null,
  } satisfies CiExport);
});

afterEach(cleanup);

describe("ExportWizard (AC-1)", () => {
  it("mounts with all 4 steps visible in the progress indicator", () => {
    renderWizard();
    expect(screen.getByText("Target")).toBeInTheDocument();
    expect(screen.getByText("Preview")).toBeInTheDocument();
    expect(screen.getByText("Configure")).toBeInTheDocument();
    expect(screen.getByText("Install")).toBeInTheDocument();
  });

  it("rejects a malformed repo slug and does not advance (AC-15)", () => {
    renderWizard();
    const repoInput = screen.getByPlaceholderText("acme/payments-api");
    fireEvent.change(repoInput, { target: { value: "../evil" } });
    fireEvent.click(screen.getByText("Next"));
    expect(screen.getByText("Enter a valid owner/name repository slug.")).toBeInTheDocument();
    // Still on the Target step — Preview's generating/heading text absent.
    expect(screen.queryByText("Files to create")).not.toBeInTheDocument();
  });

  it("advances Target -> Preview -> Configure -> Install and calls the export mutation on Install (AC-2)", async () => {
    renderWizard();

    const repoInput = screen.getByPlaceholderText("acme/payments-api");
    fireEvent.change(repoInput, { target: { value: "acme/payments-api" } });
    fireEvent.click(screen.getByText("Next"));

    await waitFor(() => expect(mocks.exportMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ repo: "acme/payments-api", target: "gha", action: "files" }),
    ));
    await waitFor(() => expect(screen.getByText("Files to create")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Next")); // Preview -> Configure
    expect(screen.getByText("Post results as")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Next")); // Configure -> Install
    expect(screen.getByText("How should DevDigest deliver these files?")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Install" }));

    await waitFor(() =>
      expect(mocks.exportMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ repo: "acme/payments-api", target: "gha", action: "open_pr" }),
      ),
    );
  });
});
