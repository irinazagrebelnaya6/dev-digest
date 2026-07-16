import { stringify } from 'yaml';
import { AgentManifest } from '@devdigest/shared';
import type { CiFailOn, Provider, ReviewStrategy } from '@devdigest/shared';
import { ValidationError } from '../../../platform/errors.js';

/**
 * Deterministic, zero-LLM manifest generator (AC-3, AC-13). Produces the SAME
 * `.devdigest/agents/<slug>.yaml` shape `agent-runner/src/manifest.ts` parses
 * at CI time — validated here against `AgentManifest.safeParse` BEFORE
 * serialization, so a malformed manifest never reaches the exported PR.
 * `skills` are slugs, resolved by the runner to `.devdigest/skills/<slug>.md`.
 */
export interface AgentManifestSource {
  name: string;
  provider: Provider;
  model: string;
  systemPrompt: string;
  /** Linked skill slugs, in order — NOT bodies (those go in separate files). */
  skills: string[];
  strategy: ReviewStrategy;
  ciFailOn: CiFailOn;
}

export function agentYaml(source: AgentManifestSource): { yaml: string; manifest: AgentManifest } {
  const candidate = {
    name: source.name,
    provider: source.provider,
    model: source.model,
    system_prompt: source.systemPrompt,
    skills: source.skills,
    strategy: source.strategy,
    ci_fail_on: source.ciFailOn,
  };

  const result = AgentManifest.safeParse(candidate);
  if (!result.success) {
    throw new ValidationError(
      'Generated agent manifest failed AgentManifest validation',
      result.error.issues,
    );
  }

  return { yaml: stringify(result.data), manifest: result.data };
}
