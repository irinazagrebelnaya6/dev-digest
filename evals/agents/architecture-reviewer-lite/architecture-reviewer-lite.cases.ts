import type { AgentCase } from "../../src/index.js";
import { cases as strictCases } from "../architecture-reviewer/architecture-reviewer.cases.js";

/**
 * Lite reuses the strict variant's fixtures, prompts, and thresholds verbatim — the
 * ONLY thing that differs between the two agents is whether they cite a documented
 * rule identifier per finding. So the lite eval drops exactly the rule-id-citation
 * practices: grading lite's own gate on a capability it was DELIBERATELY built
 * without would just re-assert the known A/B difference (and guarantee red — the
 * reviewer-core case alone has two such practices). That difference is instead what
 * the strict-vs-lite comparison (`eval:repeat` + `eval:delta`) measures. Everything
 * else the strict cases check — finding the violation, severity, a verbatim quote,
 * the closing gate verdict, not fabricating on benign/out-of-scope diffs — still
 * applies to lite unchanged.
 */
const isRuleIdPractice = (p: string): boolean => /documented rule identifier/i.test(p);

export const cases: AgentCase[] = strictCases.map((c) => ({
  ...c,
  practices: c.practices?.filter((p) => !isRuleIdPractice(p)),
}));
