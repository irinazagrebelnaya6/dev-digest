import type { WorkflowCase } from "../src/index.js";

/**
 * Systemic ("workflow") tier — asserts the real on-disk harness (CLAUDE.md + skills + subagents,
 * loaded via settingSources:["project"]) behaves as documented. Organized by scenario, not by a
 * single artifact, because these behaviors are cross-cutting.
 *
 * Budget: 6 Claude sessions total.
 *   - 2 × trace                 → 1 session each                       = 2
 *   - 1 × contrast (treatment + control)                               = 2
 *   - 1 × activation pair (positive + near-miss negative)              = 2
 *
 * `trace` folds several assertions into ONE session (cheaper, coarser) and stops early once its
 * evidence is in — so a dispatch-bearing trace never waits out the nested subagent's full run.
 *
 * `contrast` is the only kind that isolates CLAUDE.md's specific causal contribution: it runs the
 * SAME prompt twice — once against the real repo (CLAUDE.md loaded) and once against an empty
 * tmpdir with no on-disk config — and asserts the routed file is read in treatment and NOT in
 * control. A prior version of the gotchas-routing case used `contrast` and was downgraded to
 * `trace` because the control leaked: with `Glob` allowed and `bypassPermissions`, the model could
 * search outside the tmpdir and still find the real repo's file on the same filesystem. The fix
 * here is `tools: ["Read"]` — no `Glob`/`Grep` — so control has no way to DISCOVER an unknown
 * absolute path (it would have to blind-guess this machine's real repo path), while treatment
 * still succeeds because CLAUDE.md's routing table hands it the path directly, no search needed.
 */
export const cases: WorkflowCase[] = [
  // --- trace (1 session): CLAUDE.md "Read When" routing + subagent dispatch, together -----------
  {
    kind: "trace",
    // Endpoint must NOT already exist, or the model reviews the existing code inline instead of
    // planning-then-dispatching. GET /reviews/:id/export is genuinely absent from routes.ts.
    name: "API-route task reads api-contracts AND pulls the architecture-reviewer",
    prompt:
      "Я планую додати НОВИЙ, ще не реалізований ендпоінт GET /reviews/:id/export (віддає ревʼю як " +
      "markdown). Спершу звірся з конвенціями API цього репо. Потім ОБОВʼЯЗКОВО запусти сабагента " +
      "architecture-reviewer, щоб він оцінив мій план на відповідність onion-шарам — не рецензуй сам.",
    expectFilesRead: ["docs/server/api-contracts.md"],
    expectSubagents: ["architecture-reviewer"],
    maxTurns: 8,
  },

  // --- trace (1 session): two "Read When" rows at once -----------------------------------------
  {
    kind: "trace",
    // Tests the CLAUDE.md "Read When" routing, so the prompt must push toward CONSULTING the docs,
    // not exploring source. Earlier phrasing ("розберись, як усе влаштовано") sent the model straight
    // into schema.ts / pipeline.run.ts and it never opened the routed doc. One anchor doc (pipeline.md)
    // keeps this a deterministic routing check — asserting two docs in one session is inherently flaky.
    name: "pipeline task follows CLAUDE.md routing to pipeline.md",
    prompt:
      "Я збираюся змінити review pipeline. Перш ніж торкатися коду — звірся з настановами цього репо " +
      "(CLAUDE.md) щодо того, яку документацію треба прочитати для змін у pipeline, і прочитай саме ці документи.",
    expectFilesRead: ["reviewer-core/docs/pipeline.md"],
    maxTurns: 8,
  },

  // --- contrast (2 sessions): CLAUDE.md's own contribution, isolated -----------------------------
  // tools: ["Read"] only (no Glob/Grep) is what makes the control trustworthy — see the file-level
  // comment above for why. Both treatment and control get the same restricted tool set, so the
  // comparison stays a clean single-variable A/B (CLAUDE.md loaded or not — nothing else differs).
  {
    kind: "contrast",
    name: "CLAUDE.md routes a gotchas lookup to reviewer-core/INSIGHTS.md",
    prompt:
      "У reviewer-core я стикнувся з несподіваною поведінкою — щось працює не так, як я очікував. " +
      "За настановами цього репо, де це вже могло бути задокументовано? Прочитай той файл.",
    expectFileRead: "reviewer-core/INSIGHTS.md",
    tools: ["Read"],
    maxTurns: 5,
  },

  // --- activation pair (2 sessions): positive + near-miss negative ------------------------------
  {
    kind: "activation",
    name: "engineering-insights activates on a genuine discovery",
    prompt:
      "Щойно з'ясував, чому pgvector-запит повертав нуль рядків — розмірність колонки не збіглася " +
      "після зміни моделі ембедингів. Хочу це зафіксувати, щоб більше не наступати.",
    skill: "engineering-insights",
    shouldActivate: true,
    maxTurns: 4,
  },
  {
    kind: "activation",
    name: "near-miss negative — explaining the same topic must NOT record an insight",
    prompt:
      "Поясни, як у pgvector працюють розмірності колонок і чому невідповідність повертає нуль рядків.",
    skill: "engineering-insights",
    shouldActivate: false,
    maxTurns: 4,
  },
];
