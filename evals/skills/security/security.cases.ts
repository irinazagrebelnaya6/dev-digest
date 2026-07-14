import type { SkillCase } from "../../src/index.js";
import { fixtureReader } from "../../src/index.js";

const fx = fixtureReader(import.meta.url);

// The `security` skill is a REVIEW skill: given a code change on its stated stack
// (Express + MongoDB + JWT + React), it should flag real, HIGH-confidence OWASP
// issues AND — per its own "Confidence-Based Review" section — NOT flag
// server-controlled values or framework-mitigated patterns. These cases exercise
// both directions (recall on genuine vulns, precision on safe-but-scary code), so a
// later edit to the skill's description/instructions that quietly breaks either shows
// up as a red test. Content-only via skillTask (no tools): the diff is inlined and
// the model answers directly from it.

const REVIEW_PROMPT = (diffFile: string) =>
  `Review this diff for security vulnerabilities using the security skill. For each real ` +
  `issue give the OWASP category, the concrete exploit, and a fix. Do not report ` +
  `low-confidence or server-controlled/framework-mitigated patterns.\n\n${fx(diffFile)}`;

export const cases: SkillCase[] = [
  {
    // RECALL: the vulnerable diff packs several textbook HIGH-confidence issues that map
    // directly onto the skill's OWASP:2025 table. A skill that lost its teeth (e.g. a
    // reworded description that no longer triggers, or a weakened checklist) will miss some.
    name: "flags the real OWASP issues in a vulnerable Express/Mongo/JWT route",
    kind: "quality",
    prompt: REVIEW_PROMPT("vulnerable-api.diff"),
    practices: [
      "flags the hardcoded JWT secret ('dev-secret') as a cryptographic failure / hardcoded secret (A04) and says the secret must come from an environment variable with sufficient entropy",
      "flags `jwt.decode(token)` being used instead of `jwt.verify(...)` as an authentication failure (A07) — the token signature is never validated, so claims are attacker-forgeable",
      "flags the MongoDB query `User.findOne({ username: req.query.name })` as operator/NoSQL injection (A05) because an attacker can pass an object like `{ $ne: null }` via the query string",
      "flags the missing authentication/authorization on the user routes (A01 broken access control) — the GET/PATCH handlers have no auth middleware and the PATCH performs no ownership check",
      "flags the mass-assignment risk of passing `req.body` straight into `findByIdAndUpdate` (A08 integrity failure / mass assignment)",
      "for each reported issue it names an OWASP category AND gives a concrete remediation, not just a description",
    ],
    threshold: 0.7,
    maxTurns: 8,
  },
  {
    // PRECISION / negative: the skill's "Golden rule" and "Do NOT flag" list say a
    // server-controlled `process.env` value and React JSX-escaped output are SAFE. A skill
    // that regressed into noise (flagging everything that pattern-matches "fetch(...)" or
    // "{value}") fails here. This is the case most likely to catch an over-eager rewrite.
    name: "does NOT fabricate a vuln for server-controlled input or JSX-escaped output",
    kind: "quality",
    prompt: REVIEW_PROMPT("safe-server-controlled.diff"),
    practices: [
      "does NOT report the `fetch(`${process.env.UPSTREAM_URL}/rates`)` call as SSRF — it correctly treats the URL as a server-controlled config value (not attacker-controlled), per the skill's golden rule",
      "does NOT report the React `<span>{label}</span>` render as XSS — it recognizes React JSX auto-escapes interpolated values and the value is a build-time constant",
      "concludes there are no HIGH-confidence vulnerabilities in this diff (an empty/approve result, or at most a low-confidence note), rather than inventing a blocking finding",
    ],
    threshold: 1.0,
    maxTurns: 8,
  },
  {
    // GROUNDING + judge: a concrete remediation fact must appear (a real stronger hash),
    // gated cheaply by patternMatch before the judge runs, then the judge checks it framed
    // the issue correctly as A04.
    name: "flags MD5 password hashing and recommends a real password hash",
    kind: "quality",
    prompt: REVIEW_PROMPT("weak-password-hash.diff"),
    grounding: [["bcrypt", "argon2", "argon2id", "scrypt"]],
    practices: [
      "flags `crypto.createHash('md5')` used for password hashing as a cryptographic failure (A04) — MD5 is fast and unsalted, unsuitable for passwords",
      "recommends a proper password-hashing function (bcrypt with sufficient cost, or Argon2id/scrypt) with a per-password salt instead of a raw MD5 digest",
    ],
    threshold: 0.7,
    maxTurns: 8,
  },
];
