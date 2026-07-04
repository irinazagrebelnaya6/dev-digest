import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../messages/en/prReview.json";

const mutateAsync = vi.fn().mockResolvedValue(undefined);
let mockIntent: { intent: string; in_scope: string[]; out_of_scope: string[] } | null = null;
let mockIsLoading = false;
let mockIsPending = false;

vi.mock("@/lib/hooks/intent", () => ({
  useIntent: () => ({ data: mockIntent, isLoading: mockIsLoading }),
  useComputeIntent: () => ({ mutateAsync, isPending: mockIsPending }),
}));

import { IntentCard } from "./IntentCard";

afterEach(() => {
  cleanup();
  mutateAsync.mockClear();
  mockIntent = null;
  mockIsLoading = false;
  mockIsPending = false;
});

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("IntentCard", () => {
  it("renders a computed intent — summary + both scope lists", () => {
    mockIntent = {
      intent: "Add rate limiting to the login endpoint.",
      in_scope: ["Login route middleware", "Rate-limit config"],
      out_of_scope: ["Signup endpoint", "Password reset flow"],
    };
    renderWithIntl(<IntentCard prId="pr1" />);

    expect(screen.getByText("Add rate limiting to the login endpoint.")).toBeInTheDocument();
    expect(screen.getByText("Login route middleware")).toBeInTheDocument();
    expect(screen.getByText("Rate-limit config")).toBeInTheDocument();
    expect(screen.getByText("Signup endpoint")).toBeInTheDocument();
    expect(screen.getByText("Password reset flow")).toBeInTheDocument();
  });

  it("renders the empty state when no intent has been computed", () => {
    mockIntent = null;
    renderWithIntl(<IntentCard prId="pr1" />);

    expect(
      screen.getByText("No intent computed yet — run a review or click Recompute."),
    ).toBeInTheDocument();
  });

  it("fires the compute mutation when Recompute is clicked", () => {
    mockIntent = null;
    renderWithIntl(<IntentCard prId="pr1" />);

    fireEvent.click(screen.getByText("Recompute"));
    expect(mutateAsync).toHaveBeenCalledTimes(1);
  });
});
