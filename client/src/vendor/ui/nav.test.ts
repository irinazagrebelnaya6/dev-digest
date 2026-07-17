import { describe, it, expect } from "vitest";
import { NAV } from "./nav";

describe("nav.ts (SPEC-06 AC-25)", () => {
  it("adds a top-level GLOBAL 'Multi-Agent Review' entry with key 'multi-agent'", () => {
    const global = NAV.find((g) => g.section === "GLOBAL");
    expect(global).toBeTruthy();
    const item = global?.items.find((it) => it.key === "multi-agent");
    expect(item).toBeTruthy();
    expect(item?.label).toBe("Multi-Agent Review");
    expect(item?.href).toBe("/multi-agent");
  });

  it("does NOT add 'Agent Performance' or 'CI Runs' (out of scope per the spec)", () => {
    const allKeys = NAV.flatMap((g) => g.items.map((it) => it.key));
    expect(allKeys).not.toContain("agent-performance");
    expect(allKeys).not.toContain("ci-runs");
  });
});
