import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../messages/en/prReview.json";
import type { BlastRadiusResponse } from "@devdigest/shared";

let mockData: BlastRadiusResponse | undefined;
let mockIsLoading = false;

vi.mock("@/lib/hooks/blast", () => ({
  useBlast: () => ({ data: mockData, isLoading: mockIsLoading, isFetching: false }),
}));

import { BlastRadiusCard } from "./BlastRadiusCard";

afterEach(() => {
  cleanup();
  mockData = undefined;
  mockIsLoading = false;
});

function renderCard() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <BlastRadiusCard prId="pr1" repoFullName="acme/payments-api" headSha="sha1" />
    </NextIntlClientProvider>,
  );
}

describe("BlastRadiusCard", () => {
  it("auto-expands the first symbol with callers and links each file:line to the code", () => {
    mockData = {
      changed_symbols: [{ name: "formatCents", file: "src/lib/money.ts", kind: "function" }],
      downstream: [
        {
          symbol: "formatCents",
          callers: [
            { name: "listInvoices", file: "src/api/invoices.ts", line: 42 },
            { name: "getOrder", file: "src/api/orders.ts", line: 17 },
          ],
          endpoints_affected: ["GET /invoices"],
          crons_affected: [],
        },
      ],
      prior_prs: [{ number: 480, title: "Earlier tweak", author: "dev", overlap: ["src/lib/money.ts"] }],
      reachable_endpoints: ["GET /invoices", "POST /gateway"],
      summary: "",
      degraded: false,
    };

    renderCard();

    // Counts row: 1 symbol, 2 endpoints (union incl. reachable).
    expect(screen.getByText("1 symbol")).toBeInTheDocument();
    expect(screen.getByText("2 endpoints")).toBeInTheDocument();
    // Prior PRs section header present (collapsed).
    expect(screen.getByText("Prior PRs touching these files")).toBeInTheDocument();

    // First symbol auto-expanded → caller file:line link opens the exact line.
    const link = screen.getByText("src/api/invoices.ts:42").closest("a");
    expect(link).toHaveAttribute(
      "href",
      "https://github.com/acme/payments-api/blob/sha1/src/api/invoices.ts#L42",
    );
    expect(screen.getByText("src/api/orders.ts:17")).toBeInTheDocument();
    // Endpoint badge under the expanded symbol.
    expect(screen.getAllByText("GET /invoices").length).toBeGreaterThan(0);
  });

  it("expands the Prior PRs timeline showing #number link, author, date and note", () => {
    mockData = {
      changed_symbols: [{ name: "formatCents", file: "src/lib/money.ts", kind: "function" }],
      downstream: [
        { symbol: "formatCents", callers: [{ name: "getOrder", file: "src/api/orders.ts", line: 17 }], endpoints_affected: [], crons_affected: [] },
      ],
      prior_prs: [
        {
          number: 401,
          title: "Introduce public API namespace",
          author: "deepak.r",
          overlap: ["src/api/public/webhooks.ts"],
          date: "2026-03-18",
          note: "Original `/api/public/*` split-out.",
        },
      ],
      reachable_endpoints: [],
      summary: "",
      degraded: false,
    };
    renderCard();

    // Collapsed by default → items hidden until the header is clicked.
    expect(screen.queryByText("Introduce public API namespace")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Prior PRs touching these files"));

    const link = screen.getByText("#401").closest("a");
    expect(link).toHaveAttribute("href", "https://github.com/acme/payments-api/pull/401");
    expect(screen.getByText("Introduce public API namespace")).toBeInTheDocument();
    expect(screen.getByText("deepak.r")).toBeInTheDocument();
    expect(screen.getByText("· 2026-03-18")).toBeInTheDocument();
    expect(screen.getByText(/Original/)).toBeInTheDocument();
  });

  it("shows a degraded banner when the index is incomplete", () => {
    mockData = {
      changed_symbols: [],
      downstream: [],
      prior_prs: [],
      reachable_endpoints: [],
      summary: "",
      degraded: true,
      reason: "no_data",
    };
    renderCard();
    expect(screen.getByText(/isn't fully indexed/i)).toBeInTheDocument();
  });

  it("shows an empty state when nothing is impacted", () => {
    mockData = {
      changed_symbols: [],
      downstream: [],
      prior_prs: [],
      reachable_endpoints: [],
      summary: "",
      degraded: false,
    };
    renderCard();
    expect(screen.getByText("No impact detected")).toBeInTheDocument();
  });
});
