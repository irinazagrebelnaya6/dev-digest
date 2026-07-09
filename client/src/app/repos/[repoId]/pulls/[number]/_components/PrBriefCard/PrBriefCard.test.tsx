import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../messages/en/prReview.json";
import type { BriefResponse } from "@devdigest/shared";

const mutateAsync = vi.fn().mockResolvedValue(undefined);
let mockResponse: BriefResponse | null = null;
let mockIsLoading = false;
let mockIsError = false;
let mockIsPending = false;
const refetch = vi.fn();

vi.mock("@/lib/hooks/brief", () => ({
  usePrBrief: () => ({ data: mockResponse, isLoading: mockIsLoading, isError: mockIsError, refetch }),
  useRegeneratePrBrief: () => ({ mutateAsync, isPending: mockIsPending }),
}));

import { PrBriefCard } from "./PrBriefCard";

afterEach(() => {
  cleanup();
  mutateAsync.mockClear();
  refetch.mockClear();
  mockResponse = null;
  mockIsLoading = false;
  mockIsError = false;
  mockIsPending = false;
});

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

function makeResponse(overrides: Partial<BriefResponse["brief"]> = {}, stale = false): BriefResponse {
  return {
    generatedAt: "2026-07-07T00:00:00.000Z",
    stale,
    brief: {
      what: "Adds rate limiting to the payments webhook endpoint.",
      why: "Prevent abuse after the incident on `payments-api`.",
      risk_level: "medium",
      risks: [
        { description: "The new limiter reads Redis without a timeout.", link: "src/lib/redis.ts" },
      ],
      review_focus: [
        { label: "Rate limiter wiring", link: "src/routes/webhooks.ts" },
        { label: "Affected endpoint", link: "POST /webhooks/payments" },
      ],
      ...overrides,
    },
  };
}

describe("PrBriefCard", () => {
  it("renders what/why, risk_level by color+label, risks with links, and ordered review_focus links", () => {
    mockResponse = makeResponse();
    renderWithIntl(<PrBriefCard prId="pr1" repoFullName="acme/payments-api" headSha="abc123" />);

    expect(screen.getByText(/Adds rate limiting to the payments webhook endpoint\./)).toBeInTheDocument();
    expect(screen.getByText(/Prevent abuse after the incident/)).toBeInTheDocument();

    // risk_level: color AND text label (never color alone).
    expect(screen.getByText("Medium")).toBeInTheDocument();

    // risks[]: description + a clickable file link (real file → GitHub blob href).
    expect(screen.getByText(/The new limiter reads Redis without a timeout\./)).toBeInTheDocument();
    const fileLink = screen.getByText("src/lib/redis.ts");
    expect(fileLink.closest("a")).toHaveAttribute(
      "href",
      "https://github.com/acme/payments-api/blob/abc123/src/lib/redis.ts",
    );

    // review_focus[]: ordered list, each a label + link; endpoint links are not files.
    const focusItems = screen.getAllByRole("listitem");
    expect(focusItems).toHaveLength(2);
    expect(focusItems[0]).toHaveTextContent("Rate limiter wiring");
    expect(focusItems[1]).toHaveTextContent("Affected endpoint");
    const endpointLink = screen.getByText("POST /webhooks/payments");
    expect(endpointLink.closest("a")).toBeNull();
  });

  it("maps high/medium/low risk_level to distinct colors and text labels", () => {
    mockResponse = makeResponse({ risk_level: "high" });
    renderWithIntl(<PrBriefCard prId="pr1" />);
    expect(screen.getByText("High")).toBeInTheDocument();
  });

  it("shows a stale badge when the envelope's stale flag is true", () => {
    mockResponse = makeResponse({}, true);
    renderWithIntl(<PrBriefCard prId="pr1" />);
    expect(screen.getByText(/may be outdated/i)).toBeInTheDocument();
  });

  it("shows a degraded note with the reason when brief.degraded is true", () => {
    mockResponse = makeResponse({ degraded: true, reason: "generation_failed" });
    renderWithIntl(<PrBriefCard prId="pr1" />);
    expect(screen.getByText(/generation_failed/)).toBeInTheDocument();
  });

  it("renders the empty state when no brief is available", () => {
    mockResponse = null;
    renderWithIntl(<PrBriefCard prId="pr1" />);
    expect(screen.getByText("No brief yet")).toBeInTheDocument();
  });

  it("renders an error state and allows retry when the query fails", () => {
    mockResponse = null;
    mockIsError = true;
    renderWithIntl(<PrBriefCard prId="pr1" />);
    expect(screen.getByText("Couldn’t load the brief.")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Retry"));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("fires the regenerate mutation when Regenerate is clicked", () => {
    mockResponse = makeResponse();
    renderWithIntl(<PrBriefCard prId="pr1" />);
    fireEvent.click(screen.getByText("Regenerate"));
    expect(mutateAsync).toHaveBeenCalledTimes(1);
  });
});
