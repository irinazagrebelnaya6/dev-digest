import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Conflict } from "@devdigest/shared";
import messages from "../../../../../../messages/en/multiAgent.json";

import { AgentsDisagree } from "./AgentsDisagree";

afterEach(cleanup);

const conflictGroup: Conflict = {
  file: "src/middleware/ratelimit.ts",
  line: 28,
  title: "Magic number 3600",
  takes: [
    { agent_id: "a1", persona: "Junior Mentor", verdict: "SUGGESTION", note: "Extract for readability." },
    { agent_id: "a2", persona: "Security", verdict: "ignored", note: "Not a security concern." },
    { agent_id: "a3", persona: "Architecture", verdict: "did_not_run", note: "" },
  ],
};

// All flaggers agree, no "ignored" among enabled in-run agents → NOT a conflict
// per the AC-21 predicate (only a "did not run" absence, which never counts).
const nonConflictGroup: Conflict = {
  file: "src/api/users.ts",
  line: 45,
  title: "N+1 query",
  takes: [
    { agent_id: "a1", persona: "Performance", verdict: "WARNING", note: "Confirmed N+1." },
    { agent_id: "a3", persona: "Architecture", verdict: "did_not_run", note: "" },
  ],
};

function renderBlock(conflicts: Conflict[]) {
  render(
    <NextIntlClientProvider locale="en" messages={{ multiAgent: messages }}>
      <AgentsDisagree conflicts={conflicts} />
    </NextIntlClientProvider>,
  );
}

describe("AgentsDisagree (SPEC-06 AC-19..21)", () => {
  it("AC-19/AC-20: groups by location and renders distinct 'did not flag' vs 'did not run' verdicts", () => {
    renderBlock([conflictGroup]);
    expect(screen.getByText("Magic number 3600")).toBeInTheDocument();
    expect(screen.getByText("did not flag")).toBeInTheDocument();
    expect(screen.getByText("did not run")).toBeInTheDocument();
    // Distinct icons — different <svg> markup means different lucide icon
    // components render, not just different text.
    const ignored = screen.getByText("did not flag").closest("div");
    const notRun = screen.getByText("did not run").closest("div");
    expect(ignored?.querySelector("svg")?.outerHTML).not.toEqual(notRun?.querySelector("svg")?.outerHTML);
  });

  it("AC-21: 'Show only conflicts' filters out groups where all flaggers agree and nobody actively ignored it", () => {
    renderBlock([conflictGroup, nonConflictGroup]);
    expect(screen.getByText("Magic number 3600")).toBeInTheDocument();
    expect(screen.getByText("N+1 query")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("switch"));

    expect(screen.getByText("Magic number 3600")).toBeInTheDocument();
    expect(screen.queryByText("N+1 query")).not.toBeInTheDocument();
  });

  it("shows an empty state when there are no location groups", () => {
    renderBlock([]);
    expect(screen.getByText("No cross-agent disagreements yet.")).toBeInTheDocument();
  });
});
