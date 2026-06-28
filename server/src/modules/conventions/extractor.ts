import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Container } from '../../platform/container.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import type { InsertConvention } from './repository.js';

/** Config filenames to try loading as context for the LLM. */
const CONFIG_CANDIDATES = [
  'eslint.config.js',
  'eslint.config.ts',
  'eslint.config.mjs',
  '.eslintrc.js',
  '.eslintrc.json',
  '.eslintrc.yml',
  'tsconfig.json',
  'tsconfig.base.json',
  'prettier.config.js',
  'prettier.config.ts',
  '.prettierrc',
  '.prettierrc.json',
];

const MIN_CONFIDENCE = 0.5;
const SAMPLE_FILE_COUNT = 12;
const MAX_FILE_CHARS = 3_000;  // truncate large files in the prompt
const MAX_CONFIG_CHARS = 2_000;

// ---- LLM output schema --------------------------------------------------- //

const LLMCandidate = z.object({
  category: z.string().describe('Short category label, e.g. "naming", "imports", "error-handling"'),
  rule: z.string().describe('One-sentence directive rule the codebase follows'),
  evidence_path: z.string().describe('Repo-relative file path that demonstrates the rule'),
  evidence_snippet: z.string().describe('Exact short code excerpt (≤120 chars) from that file'),
  evidence_line: z.number().int().optional().describe('Approximate 1-based line number of the snippet'),
  confidence: z.number().min(0).max(1).describe('0–1 confidence that this is a real convention'),
});

const LLMOutput = z.object({
  candidates: z.array(LLMCandidate),
});

// ---- Public API ---------------------------------------------------------- //

export interface ExtractionResult {
  runId: string;
  total: number;
  kept: number;
  dropped: number;
  candidates: InsertConvention[];
}

export async function extractConventions(
  container: Container,
  workspaceId: string,
  repoId: string,
  repoRef: { owner: string; name: string; defaultBranch: string },
): Promise<ExtractionResult> {
  const runId = randomUUID();
  const git = container.git;
  const ref = { owner: repoRef.owner, name: repoRef.name };

  // ---- 1. Load config files (best-effort) -------------------------------- //
  const configSections: string[] = [];
  for (const filename of CONFIG_CANDIDATES) {
    try {
      const content = await git.readFile(ref, filename);
      configSections.push(`### ${filename}\n\`\`\`\n${content.slice(0, MAX_CONFIG_CHARS)}\n\`\`\``);
    } catch {
      // file doesn't exist — skip silently
    }
    if (configSections.length >= 4) break;  // enough config context
  }

  // ---- 2. Get top-N file paths via repo-intel ---------------------------- //
  const samplePaths = await container.repoIntel.getConventionSamples(repoId, SAMPLE_FILE_COUNT);

  // ---- 3. Read file contents (best-effort) ------------------------------- //
  const fileSections: string[] = [];
  const fileContents = new Map<string, string>();
  for (const path of samplePaths) {
    try {
      const content = await git.readFile(ref, path);
      fileContents.set(path, content);
      fileSections.push(`### ${path}\n\`\`\`\n${content.slice(0, MAX_FILE_CHARS)}\n\`\`\``);
    } catch {
      // file missing in clone — skip
    }
  }

  // ---- 4. Build prompt --------------------------------------------------- //
  const configBlock = configSections.length > 0
    ? `## Config files\n\n${configSections.join('\n\n')}`
    : '## Config files\n\n(none found)';

  const filesBlock = fileSections.length > 0
    ? `## Source files\n\n${fileSections.join('\n\n')}`
    : '## Source files\n\n(none available — repo-intel index may not be synced)';

  const systemPrompt = `You are a code convention extractor. Your job is to find coding conventions that the team CONSISTENTLY follows throughout their codebase — not style preferences, but patterns enforced by real code.

Rules for a valid candidate:
- Must be observable in the provided files (not inferred)
- Rule must be a short directive sentence (e.g. "Always use named exports, never default exports")
- evidence_snippet must be an exact substring of the file content shown
- Confidence > 0.7 only when the pattern appears in 3+ files
- Skip trivial/universal rules (e.g. "use semicolons") unless the config explicitly enforces them

Return 5–15 candidates. Prefer fewer high-confidence ones over many weak ones.`;

  const userMessage = `Analyse this repository and extract coding conventions.

Repository: ${repoRef.owner}/${repoRef.name} (${repoRef.defaultBranch})

${configBlock}

${filesBlock}`;

  // ---- 5. Resolve LLM and call ------------------------------------------ //
  const { provider, model } = await resolveFeatureModel(container, workspaceId, 'conventions');
  const llm = await container.llm(provider);

  const { data } = await llm.completeStructured({
    model,
    schema: LLMOutput,
    schemaName: 'ConventionCandidates',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    temperature: 0.1,
    maxTokens: 4_000,
  });

  // ---- 6. Grounding check (pure code, no model) -------------------------- //
  const total = data.candidates.length;
  const survivors: InsertConvention[] = [];

  for (const c of data.candidates) {
    // Drop low-confidence candidates
    if ((c.confidence ?? 0) < MIN_CONFIDENCE) continue;

    // evidence_path must exist in the files we actually read
    const fileContent = fileContents.get(c.evidence_path);
    if (!fileContent) {
      // Path wasn't in our sample — try reading it directly
      let directContent: string | null = null;
      try {
        directContent = await git.readFile(ref, c.evidence_path);
      } catch {
        // file doesn't exist in repo — drop
        continue;
      }
      // evidence_snippet must appear in the file
      if (c.evidence_snippet && !directContent.includes(c.evidence_snippet)) continue;
      fileContents.set(c.evidence_path, directContent);
    } else {
      // evidence_snippet must appear in the file we already have
      if (c.evidence_snippet && !fileContent.includes(c.evidence_snippet)) continue;
    }

    survivors.push({
      workspaceId,
      repoId,
      extractionRunId: runId,
      category: c.category,
      rule: c.rule,
      evidencePath: c.evidence_path,
      evidenceSnippet: c.evidence_snippet,
      evidenceLine: c.evidence_line,
      confidence: c.confidence,
    });
  }

  return {
    runId,
    total,
    kept: survivors.length,
    dropped: total - survivors.length,
    candidates: survivors,
  };
}
