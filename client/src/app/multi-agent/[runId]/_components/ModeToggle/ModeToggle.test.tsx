import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../messages/en/multiAgent.json";

import { ModeToggle } from "./ModeToggle";

afterEach(cleanup);

function renderToggle(mode: "columns" | "tabs", onChange = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={{ multiAgent: messages }}>
      <ModeToggle mode={mode} onChange={onChange} />
    </NextIntlClientProvider>,
  );
  return onChange;
}

describe("ModeToggle (SPEC-06 AC-13)", () => {
  it("marks the active mode and switches on click", () => {
    const onChange = renderToggle("columns");
    expect(screen.getByText("Columns").closest("button")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Tabs").closest("button")).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByText("Tabs"));
    expect(onChange).toHaveBeenCalledWith("tabs");
  });
});
