import { describe, it, expect } from "vitest";
import { activeKeyFor } from "./helpers";

describe("activeKeyFor (SPEC-06 AC-25)", () => {
  it("maps any /multi-agent… path to the 'multi-agent' sidebar key (pre-wired; verified, not re-wired)", () => {
    expect(activeKeyFor("/multi-agent")).toBe("multi-agent");
    expect(activeKeyFor("/multi-agent/run-123")).toBe("multi-agent");
  });
});
