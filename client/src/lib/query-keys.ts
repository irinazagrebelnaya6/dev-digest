/* query-keys.ts — Centralized query key factory. Eliminates magic strings
   across hooks and ensures invalidations are always consistent. */

export const queryKeys = {
  // Settings
  settings: () => ["settings"] as const,
  secretsStatus: () => ["secrets-status"] as const,
  providerModels: (provider: string | null | undefined) =>
    ["provider-models", provider] as const,

  // Repos
  repos: () => ["repos"] as const,
  pulls: (repoId: string | null | undefined) => ["pulls", repoId] as const,
  pull: (prId: string | number | null | undefined) => ["pull", prId] as const,

  // Context / repo-intel
  context: (repoId: string | null | undefined) => ["context", repoId] as const,

  // Project Context Folder (attached repo docs — specs/docs/insights .md)
  projectContext: (repoId: string | null | undefined) => ["project-context", repoId] as const,

  // Onboarding Tour (SPEC-03)
  onboarding: (repoId: string | null | undefined) => ["onboarding", repoId] as const,

  // Agents
  agents: () => ["agents"] as const,
  agent: (id: string | null | undefined) => ["agent", id] as const,

  // Skills
  skills: () => ["skills"] as const,
  skill: (id: string | null | undefined) => ["skill", id] as const,
  skillStats: (id: string | null | undefined) => ["skill-stats", id] as const,
  skillVersions: (id: string | null | undefined) => ["skill-versions", id] as const,
  agentSkills: (agentId: string | null | undefined) => ["agent-skills", agentId] as const,

  // Conventions
  conventions: (repoId: string | null | undefined) => ["conventions", repoId] as const,

  // PR reviews & runs
  reviews: (prId: string | null | undefined) => ["reviews", prId] as const,
  prRuns: (prId: string | null | undefined) => ["pr-runs", prId] as const,
  prActiveRuns: (prId: string | null | undefined) =>
    ["pr-active-runs", prId] as const,
  prComments: (prId: string | null | undefined) =>
    ["pr-comments", prId] as const,
  prIntent: (prId: string | null | undefined) => ["pr-intent", prId] as const,
  prRisks: (prId: string | null | undefined) => ["pr-risks", prId] as const,
  prSmartDiff: (prId: string | null | undefined) => ["pr-smart-diff", prId] as const,
  prBlast: (prId: string | null | undefined) => ["pr-blast", prId] as const,
  prBrief: (prId: string | null | undefined) => ["pr-brief", prId] as const,

  // Evals (SPEC-05)
  evalCases: (agentId: string | null | undefined) => ["eval-cases", agentId] as const,
  evalCase: (id: string | null | undefined) => ["eval-case", id] as const,
  agentEvalRuns: (agentId: string | null | undefined) => ["agent-eval-runs", agentId] as const,
  evalDashboard: () => ["eval-dashboard"] as const,
  agentEvalDashboard: (agentId: string | null | undefined) => ["agent-eval-dashboard", agentId] as const,
  evalCompare: (a: string | null | undefined, b: string | null | undefined) =>
    ["eval-compare", a, b] as const,

  // Multi-Agent Review (SPEC-06)
  multiAgentRun: (runId: string | null | undefined) => ["multi-agent-run", runId] as const,
  multiAgentEconomics: (runId: string | null | undefined) =>
    ["multi-agent-run-economics", runId] as const,
  agentEstimates: (prId: string | null | undefined) => ["agent-estimates", prId] as const,
  // Export to CI (SPEC-06)
  ciInstallations: (agentId: string | null | undefined) => ["ci-installations", agentId] as const,
  agentCiRuns: (agentId: string | null | undefined) => ["agent-ci-runs", agentId] as const,
  workspaceCiRuns: (repo?: string | null, agentId?: string | null) =>
    ["workspace-ci-runs", repo ?? null, agentId ?? null] as const,
} as const;
