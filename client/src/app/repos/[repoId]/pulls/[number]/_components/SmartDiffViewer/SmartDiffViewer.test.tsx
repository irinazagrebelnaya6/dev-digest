import { describe, it, expect, afterEach, beforeAll, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../messages/en/prReview.json";
import shellMessages from "../../../../../../../../messages/en/shell.json";
import type { SmartDiffResponse } from "@devdigest/shared";
import type { PrFile } from "@/lib/types";

let mockData: SmartDiffResponse | null = null;
let mockIsLoading = false;
let mockIsError = false;

vi.mock("@/lib/hooks/smart-diff", () => ({
  useSmartDiff: () => ({ data: mockData, isLoading: mockIsLoading, isError: mockIsError }),
}));

import { SmartDiffViewer } from "./SmartDiffViewer";

const CORE_PATCH = "@@ -1,1 +1,1 @@\n+core added line";
const BOILERPLATE_PATCH = "@@ -1,1 +1,2 @@\n+lock line one\n context line";

const files: PrFile[] = [
  { path: "src/modules/service.ts", additions: 5, deletions: 1, patch: CORE_PATCH },
  { path: "pnpm-lock.yaml", additions: 100, deletions: 0, patch: BOILERPLATE_PATCH },
];

function smartDiffFixture(boilerplateFindingLines: number[]): SmartDiffResponse {
  return {
    groups: [
      {
        role: "core",
        files: [
          {
            path: "src/modules/service.ts",
            pseudocode_summary: null,
            additions: 5,
            deletions: 1,
            finding_lines: [],
          },
        ],
      },
      { role: "wiring", files: [] },
      {
        role: "boilerplate",
        files: [
          {
            path: "pnpm-lock.yaml",
            pseudocode_summary: null,
            additions: 100,
            deletions: 0,
            finding_lines: boilerplateFindingLines,
          },
        ],
      },
    ],
    split_suggestion: { too_big: false, total_lines: 106, proposed_splits: [] },
  };
}

let scrollIntoViewMock: ReturnType<typeof vi.fn>;

beforeAll(() => {
  scrollIntoViewMock = vi.fn();
  Element.prototype.scrollIntoView = scrollIntoViewMock;
});

afterEach(() => {
  cleanup();
  mockData = null;
  mockIsLoading = false;
  mockIsError = false;
  scrollIntoViewMock.mockClear();
});

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages, shell: shellMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("SmartDiffViewer", () => {
  it("renders boilerplate collapsed and core expanded (AC5)", () => {
    mockData = smartDiffFixture([]);
    renderWithIntl(<SmartDiffViewer prId="pr1" files={files} />);

    // Core group is expanded by default — its diff line text is visible.
    expect(screen.getByText("core added line")).toBeInTheDocument();
    // Boilerplate group is collapsed by default — its diff body isn't rendered.
    expect(screen.queryByText("lock line one")).not.toBeInTheDocument();
  });

  it("renders a findings badge only for files with finding_lines", () => {
    mockData = smartDiffFixture([2]);
    renderWithIntl(<SmartDiffViewer prId="pr1" files={files} />);

    expect(screen.getByText(/1 findings/i)).toBeInTheDocument();
  });

  it("does not render a findings badge for a file with no findings", () => {
    mockData = smartDiffFixture([]);
    renderWithIntl(<SmartDiffViewer prId="pr1" files={files} />);

    expect(screen.queryByText(/findings/i)).not.toBeInTheDocument();
  });

  it("toggling to Original order renders the plain diff (AC5)", () => {
    mockData = smartDiffFixture([]);
    renderWithIntl(<SmartDiffViewer prId="pr1" files={files} />);

    expect(screen.getByText(messages.smartDiff.coreSubtitle)).toBeInTheDocument();

    fireEvent.click(screen.getByText(messages.smartDiff.originalOrder));

    expect(screen.queryByText(messages.smartDiff.coreSubtitle)).not.toBeInTheDocument();
    // Original DiffViewer renders every file regardless of role/collapse state.
    expect(screen.getByText("core added line")).toBeInTheDocument();
  });

  it("clicking the findings badge expands the file and scrolls to the first finding line (AC6)", () => {
    mockData = smartDiffFixture([2]);
    renderWithIntl(<SmartDiffViewer prId="pr1" files={files} />);

    // Boilerplate file starts collapsed.
    expect(screen.queryByText("lock line one")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText(/1 findings/i));

    // Clicking the badge force-expands the (previously collapsed) file.
    expect(screen.getByText("lock line one")).toBeInTheDocument();
    expect(scrollIntoViewMock).toHaveBeenCalledWith(expect.objectContaining({ block: "center" }));
  });

  it("falls back to the plain diff while loading", () => {
    mockData = null;
    mockIsLoading = true;
    renderWithIntl(<SmartDiffViewer prId="pr1" files={files} />);

    expect(screen.getByText("core added line")).toBeInTheDocument();
    expect(screen.getByText("lock line one")).toBeInTheDocument();
  });
});
