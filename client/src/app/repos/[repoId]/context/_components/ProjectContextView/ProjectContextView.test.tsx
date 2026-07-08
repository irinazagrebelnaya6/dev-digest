import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../messages/en/projectContext.json";
import type { ProjectContextResponse } from "@/lib/hooks/project-context";

let mockData: ProjectContextResponse | undefined;
let mockIsLoading = false;
let mockIsError = false;

vi.mock("@/lib/hooks/project-context", () => ({
  useProjectContext: () => ({ data: mockData, isLoading: mockIsLoading, isError: mockIsError, refetch: vi.fn() }),
}));

import { ProjectContextView } from "./ProjectContextView";

afterEach(() => {
  cleanup();
  mockData = undefined;
  mockIsLoading = false;
  mockIsError = false;
});

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ projectContext: messages }}>
      <ProjectContextView repoId="repo1" />
    </NextIntlClientProvider>,
  );
}

describe("ProjectContextView", () => {
  it("lists discovered docs with path, type badge, and used-by count", () => {
    mockData = {
      docs: [
        { path: "specs/SPEC-01.md", badge: "specs", used_by: 2, content: "# Spec\nBody." },
        { path: "docs/architecture.md", badge: "docs", used_by: 0, content: null },
      ],
      degraded: false,
    };
    renderView();
    // First doc is also auto-selected into the detail pane, so it appears twice.
    expect(screen.getAllByText("specs/SPEC-01.md").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("docs/architecture.md")).toBeInTheDocument();
    expect(screen.getAllByText("specs").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Used by 2 agents").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Used by 0 agents")).toBeInTheDocument();
  });

  it("previews the selected doc's markdown and falls back when no content is available", () => {
    mockData = {
      docs: [
        { path: "specs/SPEC-01.md", badge: "specs", used_by: 1, content: "# Spec\n\nSome body text." },
        { path: "docs/architecture.md", badge: "docs", used_by: 0, content: null },
      ],
      degraded: false,
    };
    renderView();
    // First doc auto-selected.
    expect(screen.getByText("Some body text.")).toBeInTheDocument();

    fireEvent.click(screen.getByText("docs/architecture.md"));
    expect(screen.getByText("Preview not available for this doc.")).toBeInTheDocument();
  });

  it("shows the empty state when no docs are discovered", () => {
    mockData = { docs: [], degraded: false };
    renderView();
    expect(screen.getByText("No project context docs found")).toBeInTheDocument();
  });

  it("shows a degraded banner when the repo isn't cloned", () => {
    mockData = { docs: [], degraded: true, reason: "not_cloned" };
    renderView();
    expect(screen.getByText(/degraded \(not_cloned\)/)).toBeInTheDocument();
  });

  it("does not render an upload/edit toolbar (read/preview only)", () => {
    mockData = {
      docs: [{ path: "specs/SPEC-01.md", badge: "specs", used_by: 1, content: "# Spec" }],
      degraded: false,
    };
    renderView();
    expect(screen.queryByRole("button", { name: /upload/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /new folder/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /edit/i })).not.toBeInTheDocument();
  });
});
