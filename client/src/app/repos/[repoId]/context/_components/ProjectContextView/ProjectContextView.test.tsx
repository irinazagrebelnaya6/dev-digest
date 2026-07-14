import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../messages/en/projectContext.json";
import { ApiError } from "@/lib/api";
import type { ProjectContextResponse } from "@/lib/hooks/project-context";

let mockData: ProjectContextResponse | undefined;
let mockIsLoading = false;
let mockIsError = false;
let mockRefetch = vi.fn().mockResolvedValue({ data: undefined });
let writeMutate = vi.fn();
let uploadMutate = vi.fn();
let createFolderMutate = vi.fn();

vi.mock("@/lib/hooks/project-context", () => ({
  useProjectContext: () => ({ data: mockData, isLoading: mockIsLoading, isError: mockIsError, refetch: mockRefetch }),
  useWriteContextDoc: () => ({ mutate: writeMutate, isPending: false }),
  useUploadContextDoc: () => ({ mutate: uploadMutate, isPending: false }),
  useCreateContextFolder: () => ({ mutate: createFolderMutate, isPending: false }),
}));

import { ProjectContextView } from "./ProjectContextView";

afterEach(() => {
  cleanup();
  mockData = undefined;
  mockIsLoading = false;
  mockIsError = false;
  mockRefetch = vi.fn().mockResolvedValue({ data: undefined });
  writeMutate = vi.fn();
  uploadMutate = vi.fn();
  createFolderMutate = vi.fn();
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

  // SPEC-02 supersedes the SPEC-01 "read/preview only" guard (D-10, AC-15):
  // the toolbar + Preview|Edit control are now expected, not absent.
  it("renders an authoring toolbar with New doc/New folder/Upload/Refresh/Open and the active root label (AC-1)", () => {
    mockData = {
      docs: [{ path: "specs/SPEC-01.md", badge: "specs", used_by: 1, content: "# Spec", hash: "h1" }],
      degraded: false,
    };
    renderView();
    expect(screen.getByRole("button", { name: /new doc/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /new folder/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /upload/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /refresh/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open/i })).toBeInTheDocument();
    expect(screen.getByText("specs/")).toBeInTheDocument();
  });

  it("toggles Preview ↔ Edit, pre-filling the raw source, and enables Save only once the buffer is dirty (AC-2/AC-3)", () => {
    mockData = {
      docs: [{ path: "specs/SPEC-01.md", badge: "specs", used_by: 1, content: "# Spec\n\nBody.", hash: "h1" }],
      degraded: false,
    };
    renderView();
    // Preview is the default mode.
    expect(screen.getByText("Body.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    const textarea = screen.getByLabelText(/raw markdown source/i) as HTMLTextAreaElement;
    expect(textarea.value).toBe("# Spec\n\nBody.");

    const saveBtn = screen.getByRole("button", { name: /^save$/i });
    expect(saveBtn).toBeDisabled();

    fireEvent.change(textarea, { target: { value: "# Spec\n\nBody. edited" } });
    expect(saveBtn).not.toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /^preview$/i }));
    expect(screen.getByText("Body.")).toBeInTheDocument();
  });

  it("Save sends { path, content, hash } to useWriteContextDoc (AC-4)", () => {
    mockData = {
      docs: [{ path: "specs/SPEC-01.md", badge: "specs", used_by: 1, content: "# Spec", hash: "h1" }],
      degraded: false,
    };
    renderView();
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    const textarea = screen.getByLabelText(/raw markdown source/i);
    fireEvent.change(textarea, { target: { value: "# Spec v2" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    expect(writeMutate).toHaveBeenCalledTimes(1);
    expect(writeMutate).toHaveBeenCalledWith(
      { path: "specs/SPEC-01.md", content: "# Spec v2", hash: "h1" },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
  });

  it("on a 409 Save conflict, keeps the edit buffer and offers Reload/Overwrite without silently clobbering (AC-13/AC-16)", () => {
    mockData = {
      docs: [{ path: "specs/SPEC-01.md", badge: "specs", used_by: 1, content: "# Spec", hash: "h1" }],
      degraded: false,
    };
    writeMutate.mockImplementation((_body, opts) => {
      opts.onError(new ApiError("content has changed since it was loaded — reload and retry", 409));
    });
    renderView();
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    const textarea = screen.getByLabelText(/raw markdown source/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "# Spec edited locally" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    expect(screen.getByRole("alert")).toHaveTextContent(/changed since you loaded it/i);
    // The user's unsaved buffer must survive the conflict.
    expect(textarea.value).toBe("# Spec edited locally");
    expect(screen.getByRole("button", { name: /reload latest/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /overwrite anyway/i })).toBeInTheDocument();
  });

  it("does not execute or inject raw HTML/<script> content when previewing (AC-14)", () => {
    mockData = {
      docs: [
        {
          path: "specs/untrusted.md",
          badge: "specs",
          used_by: 0,
          content: "Before <script>window.__pwned = true;</script> After",
          hash: "h1",
        },
      ],
      degraded: false,
    };
    renderView();
    expect(document.querySelector("script")).not.toBeInTheDocument();
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
  });

  it("disables the write controls (New doc/New folder/Upload) when the repo has no writable clone, while read/preview remains (AC-17)", () => {
    mockData = { docs: [], degraded: true, reason: "not_cloned" };
    renderView();
    expect(screen.getByRole("button", { name: /new doc/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /new folder/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /upload/i })).toBeDisabled();
    // Refresh is a read-only action and stays enabled even when degraded.
    expect(screen.getByRole("button", { name: /refresh/i })).not.toBeDisabled();
  });
});
