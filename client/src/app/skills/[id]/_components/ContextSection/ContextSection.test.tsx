import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Repo, Skill } from "@devdigest/shared";
import messages from "../../../../../../messages/en/skills.json";
import { ToastProvider } from "@/lib/toast";
import type { ProjectContextResponse } from "@/lib/hooks/project-context";

let mockUpdateMutate = vi.fn();
let mockRepos: Repo[] = [{ id: "repo1", workspace_id: "w1", owner: "acme", name: "payments-api", full_name: "acme/payments-api", default_branch: "main", clone_path: "/tmp/repo1", last_polled_at: null, created_by: null }];
let mockContext: ProjectContextResponse | undefined;
let mockContextLoading = false;

vi.mock("@/lib/hooks/skills", () => ({
  useUpdateSkill: () => ({ mutate: mockUpdateMutate, isPending: false }),
}));

vi.mock("@/lib/hooks", () => ({
  useRepos: () => ({ data: mockRepos }),
}));

vi.mock("@/lib/hooks/project-context", () => ({
  useProjectContext: () => ({ data: mockContext, isLoading: mockContextLoading, isError: false }),
}));

import { ContextSection } from "./ContextSection";

afterEach(() => {
  cleanup();
  mockUpdateMutate = vi.fn();
  mockRepos = [{ id: "repo1", workspace_id: "w1", owner: "acme", name: "payments-api", full_name: "acme/payments-api", default_branch: "main", clone_path: "/tmp/repo1", last_polled_at: null, created_by: null }];
  mockContext = undefined;
  mockContextLoading = false;
});

const SKILL: Skill = {
  id: "sk1",
  name: "PR Quality Rubric",
  description: "General review rubric",
  type: "rubric",
  source: "manual",
  body: "# Rubric\nCheck for clarity.",
  enabled: true,
  version: 2,
  context_paths: ["docs/architecture.md"],
};

function renderSection(skill: Skill) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <ToastProvider>
        <ContextSection skill={skill} />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("ContextSection", () => {
  it("shows a paths-only attached list (never the skill body or doc contents)", () => {
    renderSection(SKILL);
    expect(screen.getByText("docs/architecture.md")).toBeInTheDocument();
    expect(screen.queryByText(/Check for clarity/)).not.toBeInTheDocument();
  });

  it("shows the empty state when nothing is attached", () => {
    renderSection({ ...SKILL, context_paths: [] });
    expect(screen.getByText("No project context attached")).toBeInTheDocument();
  });

  it("detaches an attached path", () => {
    renderSection(SKILL);
    const removeBtn = screen.getByRole("button", { name: "Remove docs/architecture.md from attached context" });
    fireEvent.click(removeBtn);
    expect(mockUpdateMutate).toHaveBeenCalledWith(
      { id: "sk1", patch: { context_paths: [] } },
      expect.anything(),
    );
  });

  it("attaches a discovered doc from the picker", () => {
    mockContext = {
      docs: [
        { path: "docs/architecture.md", badge: "docs", used_by: 2 },
        { path: "insights/2026-07-07.md", badge: "insights", used_by: 0 },
      ],
      degraded: false,
    };
    renderSection(SKILL);
    expect(screen.queryByRole("button", { name: "Attach docs/architecture.md" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Attach insights/2026-07-07.md" }));
    expect(mockUpdateMutate).toHaveBeenCalledWith(
      { id: "sk1", patch: { context_paths: ["docs/architecture.md", "insights/2026-07-07.md"] } },
      expect.anything(),
    );
  });
});
