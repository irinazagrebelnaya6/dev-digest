import { describeAgent, runAgentCases } from "../../src/index.js";
// Reuses the strict variant's fixtures/prompts/thresholds, but with the rule-id-citation
// practices removed (see architecture-reviewer-lite.cases.ts): those encode the ONE capability
// lite deliberately lacks, so they belong to the strict-vs-lite A/B delta (eval:repeat +
// eval:delta), not to lite's own pass/fail gate — keeping them here would guarantee red.
import { cases } from "./architecture-reviewer-lite.cases.js";

describeAgent("architecture-reviewer-lite", () => runAgentCases("architecture-reviewer-lite", cases));
