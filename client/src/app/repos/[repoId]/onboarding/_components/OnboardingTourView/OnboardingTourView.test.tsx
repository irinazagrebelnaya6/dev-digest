import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../messages/en/onboarding.json";
import { ToastProvider } from "@/lib/toast";
import type { OnboardingResponse } from "@devdigest/shared";

let mockData: OnboardingResponse | undefined;
let mockIsLoading = false;
let mockIsError = false;
const mockRefetch = vi.fn();
const mockMutateAsync = vi.fn().mockResolvedValue(undefined);
let mockIsPending = false;

vi.mock("@/lib/hooks/onboarding", () => ({
  useOnboarding: () => ({ data: mockData, isLoading: mockIsLoading, isError: mockIsError, refetch: mockRefetch }),
  useRegenerateOnboarding: () => ({ mutateAsync: mockMutateAsync, isPending: mockIsPending }),
}));

vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({
    activeRepo: { id: "repo1", full_name: "acme/payments-api", default_branch: "main" },
  }),
}));

import { OnboardingTourView } from "./OnboardingTourView";

function baseTour(): OnboardingResponse {
  return {
    tour: {
      sections: [
        {
          kind: "architecture",
          title: "Architecture",
          body: "**Stack:** Node/Fastify + Next.js.",
          diagram: {
            nodes: [
              { id: "client", label: "Client", kind: "web" },
              { id: "api", label: "API", kind: "service" },
            ],
            edges: [{ from: "client", to: "api", label: "HTTP" }],
          },
          links: [{ label: "src/index.ts", path: "src/index.ts" }],
        },
        {
          kind: "critical_paths",
          title: "Critical paths",
          body: "- `src/lib/money.ts` — handles all currency math.",
          diagram: null,
          links: [{ label: "Handles all currency math.", path: "src/lib/money.ts" }],
        },
        {
          kind: "run_local",
          title: "How to run locally",
          body: "1. Install dependencies: `npm install`\n2. Run `npm run dev` (`next dev`)",
          diagram: null,
          links: [],
        },
        {
          kind: "reading_path",
          title: "Guided reading path",
          body: "1. `src/index.ts`\n2. `src/lib/money.ts`",
          diagram: null,
          links: [
            { label: "src/index.ts", path: "src/index.ts" },
            { label: "Core money-formatting helper.", path: "src/lib/money.ts" },
          ],
        },
        {
          kind: "first_tasks",
          title: "First tasks",
          body: "1. Read through `src/index.ts`.",
          diagram: null,
          links: [
            { label: "Read through the entrypoint.", path: "src/index.ts" },
            { label: "Read through the money helper.", path: "src/lib/money.ts" },
            { label: "Read through the router.", path: "src/api/router.ts" },
          ],
        },
      ],
    },
    generatedAt: "2026-07-01T12:00:00.000Z",
    degraded: false,
    reason: null,
    fileCount: 42,
  };
}

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ onboarding: messages }}>
      <ToastProvider>
        <OnboardingTourView repoId="repo1" />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});

afterEach(() => {
  cleanup();
  mockData = undefined;
  mockIsLoading = false;
  mockIsError = false;
  mockIsPending = false;
  mockRefetch.mockClear();
  mockMutateAsync.mockClear();
});

describe("OnboardingTourView", () => {
  it("shows the header with repo name, file count, and staleness line", () => {
    mockData = baseTour();
    renderView();
    expect(screen.getByText("Onboarding for acme/payments-api")).toBeInTheDocument();
    expect(screen.getByText(/Generated from index of 42 files/)).toBeInTheDocument();
  });

  it("renders the ON THIS PAGE anchor nav with the 5 canonical sections in order", () => {
    mockData = baseTour();
    renderView();
    const nav = screen.getByRole("navigation", { name: "On this page" });
    const links = nav.querySelectorAll("a");
    expect(Array.from(links).map((l) => l.textContent)).toEqual([
      "Architecture",
      "Critical paths",
      "How to run locally",
      "Guided reading path",
      "First tasks",
    ]);
    expect(links[0]).toHaveAttribute("href", "#onboarding-architecture");
  });

  it("renders the architecture diagram nodes and drops a null diagram gracefully", () => {
    mockData = baseTour();
    renderView();
    expect(screen.getByRole("img", { name: "Architecture diagram" })).toBeInTheDocument();
    expect(screen.getByText("Client")).toBeInTheDocument();
    expect(screen.getByText("API")).toBeInTheDocument();
    // critical_paths has diagram: null — its section still renders without throwing.
    expect(screen.getAllByText("Critical paths").length).toBeGreaterThan(0);
  });

  it("renders critical-path rows with an Open link to the GitHub blob URL", () => {
    mockData = baseTour();
    renderView();
    const cp = document.getElementById("onboarding-critical_paths")!;
    expect(within(cp).getByText("src/lib/money.ts")).toBeInTheDocument();
    expect(within(cp).getByText("Handles all currency math.")).toBeInTheDocument();
    expect(within(cp).getByRole("button", { name: "Open" })).toBeInTheDocument();
  });

  it("renders numbered run_local rows with a copy button that copies the fact command", () => {
    mockData = baseTour();
    renderView();
    const copyButtons = screen.getAllByRole("button", { name: "Copy" });
    expect(copyButtons.length).toBe(2);
    fireEvent.click(copyButtons[1]!);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("npm run dev");
  });

  it("renders reading_path files in server order with rationale", () => {
    mockData = baseTour();
    renderView();
    const section = document.getElementById("onboarding-reading_path")!;
    const paths = Array.from(section.querySelectorAll(".mono")).map((el) => el.textContent);
    expect(paths).toEqual(["src/index.ts", "src/lib/money.ts"]);
    expect(within(section).getByText("Core money-formatting helper.")).toBeInTheDocument();
  });

  it("renders first_tasks as cards with title, path, and a complexity badge", () => {
    mockData = baseTour();
    renderView();
    const ft = document.getElementById("onboarding-first_tasks")!;
    expect(within(ft).getByText("Read through the entrypoint.")).toBeInTheDocument();
    expect(within(ft).getByText("Low")).toBeInTheDocument();
    expect(within(ft).getByText("Medium")).toBeInTheDocument();
    expect(within(ft).getByText("High")).toBeInTheDocument();
  });

  it("collapses a section on header click and re-expands on a second click", () => {
    mockData = baseTour();
    renderView();
    expect(screen.getByText("Client")).toBeInTheDocument();
    const archSection = document.getElementById("onboarding-architecture")!;
    fireEvent.click(within(archSection).getByText("Architecture"));
    expect(screen.queryByText("Client")).not.toBeInTheDocument();
    fireEvent.click(within(archSection).getByText("Architecture"));
    expect(screen.getByText("Client")).toBeInTheDocument();
  });

  it("shows an honest degraded badge for index_degraded", () => {
    mockData = { ...baseTour(), degraded: true, reason: "index_degraded" };
    renderView();
    expect(screen.getByText("generated from partial index")).toBeInTheDocument();
  });

  it("shows an honest degraded badge for generation_failed, still rendering all sections (never blank)", () => {
    mockData = { ...baseTour(), degraded: true, reason: "generation_failed" };
    renderView();
    expect(screen.getByText("narrative unavailable — showing facts")).toBeInTheDocument();
    expect(screen.getAllByText("Architecture").length).toBeGreaterThan(0);
    expect(screen.getAllByText("First tasks").length).toBeGreaterThan(0);
  });

  it("calls the regenerate mutation when Regenerate is clicked", () => {
    mockData = baseTour();
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));
    expect(mockMutateAsync).toHaveBeenCalledTimes(1);
  });

  it("copies the current page URL when Share link is clicked", () => {
    mockData = baseTour();
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "Share link" }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(window.location.href);
    expect(screen.getByText("Link copied")).toBeInTheDocument();
  });

  it("shows a loading skeleton while the tour is loading", () => {
    mockIsLoading = true;
    renderView();
    expect(document.querySelectorAll(".skeleton").length).toBeGreaterThan(0);
  });

  it("shows an error state with retry on load failure", () => {
    mockIsError = true;
    renderView();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });
});
