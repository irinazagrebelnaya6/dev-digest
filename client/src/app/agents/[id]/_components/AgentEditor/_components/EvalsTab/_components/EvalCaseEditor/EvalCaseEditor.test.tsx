import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent } from "@devdigest/shared";
import messages from "../../../../../../../../../../messages/en/eval.json";

const createMutateAsync = vi.fn().mockResolvedValue({ id: "case1" });
const updateMutateAsync = vi.fn().mockResolvedValue({ id: "case1" });
const runMutateAsync = vi.fn().mockResolvedValue({ run_id: "r1" });
const toastSuccess = vi.fn();

vi.mock("@/lib/hooks/evals", async () => {
  const actual = await vi.importActual<typeof import("@/lib/hooks/evals")>("@/lib/hooks/evals");
  return {
    ...actual,
    useEvalCase: () => ({ data: undefined, isLoading: false }),
    useAgentEvalRuns: () => ({ data: [] }),
    useCreateEvalCase: () => ({ mutateAsync: createMutateAsync, isPending: false }),
    useUpdateEvalCase: () => ({ mutateAsync: updateMutateAsync, isPending: false }),
    useRunEvalCase: () => ({ mutateAsync: runMutateAsync, isPending: false }),
  };
});

vi.mock("@/lib/toast", () => ({
  useToast: () => ({ success: toastSuccess, error: vi.fn(), info: vi.fn(), toast: vi.fn() }),
}));

import { EvalCaseEditor } from "./EvalCaseEditor";

afterEach(() => {
  cleanup();
  createMutateAsync.mockClear();
  updateMutateAsync.mockClear();
  runMutateAsync.mockClear();
  toastSuccess.mockClear();
});

const AGENT: Agent = {
  id: "agent1",
  name: "Security Reviewer",
  description: "",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "You are a security reviewer.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 1,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(<NextIntlClientProvider locale="en" messages={{ eval: messages }}>{ui}</NextIntlClientProvider>);
}

describe("EvalCaseEditor (AC-20)", () => {
  it("starts with a valid-JSON skeleton and a disabled Save until a name is entered", () => {
    renderWithIntl(<EvalCaseEditor agent={AGENT} onClose={() => {}} />);
    expect(screen.getByText("valid JSON")).toBeInTheDocument();
    const saveBtn = screen.getByText("Save").closest("button")!;
    expect(saveBtn).toBeDisabled();
  });

  it("rejects invalid expected-output JSON before save (client-side, never silently accepted)", () => {
    renderWithIntl(<EvalCaseEditor agent={AGENT} onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText("stripe-key-leak"), { target: { value: "my-case" } });

    const jsonBoxes = screen.getAllByRole("textbox");
    const expectedOutputBox = jsonBoxes[jsonBoxes.length - 1]!;
    fireEvent.change(expectedOutputBox, { target: { value: "{ not valid json" } });

    expect(screen.getByText("invalid JSON")).toBeInTheDocument();
    const saveBtn = screen.getByText("Save").closest("button")!;
    expect(saveBtn).toBeDisabled();
  });

  it("rejects well-formed JSON that doesn't match the EvalExpectation shape", () => {
    renderWithIntl(<EvalCaseEditor agent={AGENT} onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText("stripe-key-leak"), { target: { value: "my-case" } });

    const jsonBoxes = screen.getAllByRole("textbox");
    const expectedOutputBox = jsonBoxes[jsonBoxes.length - 1]!;
    // Well-formed JSON, but not a `must_find`/`must_not_flag` expectation.
    fireEvent.change(expectedOutputBox, { target: { value: '{"foo": "bar"}' } });

    expect(screen.getByText("invalid JSON")).toBeInTheDocument();
  });

  it("saves a valid case and creates it via the agent-scoped route", async () => {
    renderWithIntl(<EvalCaseEditor agent={AGENT} onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText("stripe-key-leak"), { target: { value: "my-case" } });

    const saveBtn = screen.getByText("Save").closest("button")!;
    expect(saveBtn).not.toBeDisabled();
    fireEvent.click(saveBtn);

    await waitFor(() => expect(createMutateAsync).toHaveBeenCalledTimes(1));
    const payload = createMutateAsync.mock.calls[0]![0];
    expect(payload.name).toBe("my-case");
    expect(payload.expected_output.type).toBe("must_find");
  });
});
