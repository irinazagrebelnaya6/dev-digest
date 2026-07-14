import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, Repo } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/agents.json";
import { ToastProvider } from "@/lib/toast";
import type { ProjectContextResponse } from "@/lib/hooks/project-context";

let mockUpdateMutate = vi.fn();
let mockRepos: Repo[] = [{ id: "repo1", workspace_id: "w1", owner: "acme", name: "payments-api", full_name: "acme/payments-api", default_branch: "main", clone_path: "/tmp/repo1", last_polled_at: null, created_by: null }];
let mockContext: ProjectContextResponse | undefined;
let mockContextLoading = false;

vi.mock("@/lib/hooks/agents", () => ({
  useUpdateAgent: () => ({ mutate: mockUpdateMutate, isPending: false }),
}));

vi.mock("@/lib/hooks", () => ({
  useRepos: () => ({ data: mockRepos }),
}));

vi.mock("@/lib/hooks/project-context", () => ({
  useProjectContext: () => ({ data: mockContext, isLoading: mockContextLoading, isError: false }),
}));

import { ContextTab } from "./ContextTab";

afterEach(() => {
  cleanup();
  mockUpdateMutate = vi.fn();
  mockRepos = [{ id: "repo1", workspace_id: "w1", owner: "acme", name: "payments-api", full_name: "acme/payments-api", default_branch: "main", clone_path: "/tmp/repo1", last_polled_at: null, created_by: null }];
  mockContext = undefined;
  mockContextLoading = false;
});

const AGENT: Agent = {
  id: "ag1",
  name: "Security Reviewer",
  description: "Flags secrets and injection",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "You are a security reviewer.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 1,
  context_paths: ["specs/SPEC-01.md"],
};

function renderTab(agent: Agent) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: messages }}>
      <ToastProvider>
        <ContextTab agent={agent} />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("ContextTab", () => {
  it("lists attached paths and the paths-only SERIALIZES AS preview", () => {
    renderTab(AGENT);
    expect(screen.getByText("specs/SPEC-01.md")).toBeInTheDocument();
    // Preview lists paths only — never file bodies.
    const preview = screen.getByText((_, node) => node?.tagName === "PRE");
    expect(preview.textContent).toContain('"context_paths"');
    expect(preview.textContent).toContain("specs/SPEC-01.md");
    expect(preview.textContent).not.toContain("## "); // no markdown body content leaked
  });

  it("shows the empty state when no context is attached", () => {
    renderTab({ ...AGENT, context_paths: [] });
    expect(screen.getByText("No project context attached")).toBeInTheDocument();
  });

  it("removes an attached path via the keyboard-operable remove button", () => {
    renderTab(AGENT);
    const removeBtn = screen.getByRole("button", { name: "Remove specs/SPEC-01.md from attached context" });
    fireEvent.click(removeBtn);
    expect(mockUpdateMutate).toHaveBeenCalledWith(
      { id: "ag1", patch: { context_paths: [] } },
      expect.anything(),
    );
  });

  it("adds a discovered doc from the picker", () => {
    mockContext = {
      docs: [
        { path: "specs/SPEC-01.md", badge: "specs", used_by: 1 },
        { path: "docs/architecture.md", badge: "docs", used_by: 0 },
      ],
      degraded: false,
    };
    renderTab(AGENT);
    // Already-attached doc is excluded from the picker list.
    expect(screen.queryByRole("button", { name: "Attach specs/SPEC-01.md" })).not.toBeInTheDocument();
    const addBtn = screen.getByRole("button", { name: "Attach docs/architecture.md" });
    fireEvent.click(addBtn);
    expect(mockUpdateMutate).toHaveBeenCalledWith(
      { id: "ag1", patch: { context_paths: ["specs/SPEC-01.md", "docs/architecture.md"] } },
      expect.anything(),
    );
  });

  it("shows a message when the repo has no more discoverable docs", () => {
    mockContext = { docs: [{ path: "specs/SPEC-01.md", badge: "specs", used_by: 1 }], degraded: false };
    renderTab(AGENT);
    expect(screen.getByText(/No more specs\/docs\/insights/)).toBeInTheDocument();
  });
});
