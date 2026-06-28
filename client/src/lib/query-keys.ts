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

  // Agents
  agents: () => ["agents"] as const,
  agent: (id: string | null | undefined) => ["agent", id] as const,

  // Skills
  skills: () => ["skills"] as const,
  skill: (id: string | null | undefined) => ["skill", id] as const,
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
} as const;
