import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../messages/en/prReview.json";
import type { BlastRadiusResponse } from "@devdigest/shared";

let mockData: BlastRadiusResponse | undefined;
let mockIsLoading = false;

vi.mock("@/lib/hooks/blast", () => ({
  useBlast: () => ({ data: mockData, isLoading: mockIsLoading, isFetching: false }),
}));

import { BlastTab } from "./BlastTab";

afterEach(() => {
  cleanup();
  mockData = undefined;
  mockIsLoading = false;
});

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <BlastTab prId="pr1" repoFullName="acme/payments-api" headSha="sha1" />
    </NextIntlClientProvider>,
  );
}

describe("BlastTab", () => {
  it("renders callers as file:line links that open the code at that line", () => {
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
      reachable_endpoints: ["GET /invoices", "POST /gateway"],
      summary: "",
      degraded: false,
    };

    renderTab();

    // ≥2 callers rendered.
    expect(screen.getByText("listInvoices")).toBeInTheDocument();
    expect(screen.getByText("getOrder")).toBeInTheDocument();

    // The caller link opens the exact file:line on GitHub (click-to-code).
    const link = screen.getByText("src/api/invoices.ts:42").closest("a");
    expect(link).toHaveAttribute(
      "href",
      "https://github.com/acme/payments-api/blob/sha1/src/api/invoices.ts#L42",
    );

    // Endpoint + reachable endpoint surfaced.
    expect(screen.getAllByText("GET /invoices").length).toBeGreaterThan(0);
    expect(screen.getByText("POST /gateway")).toBeInTheDocument();
  });

  it("shows a degraded banner when the index is incomplete", () => {
    mockData = {
      changed_symbols: [],
      downstream: [],
      reachable_endpoints: [],
      summary: "",
      degraded: true,
      reason: "no_data",
    };
    renderTab();
    expect(screen.getByText(/isn't fully indexed/i)).toBeInTheDocument();
  });

  it("shows an empty state when nothing is impacted", () => {
    mockData = {
      changed_symbols: [],
      downstream: [],
      reachable_endpoints: [],
      summary: "",
      degraded: false,
    };
    renderTab();
    expect(screen.getByText("No impact detected")).toBeInTheDocument();
  });
});
