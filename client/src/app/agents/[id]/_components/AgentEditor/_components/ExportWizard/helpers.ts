import type { CiFile } from "@devdigest/shared";
import type { CategorizedFiles, TriggerState } from "./types";

/**
 * Splits the flat `CiFile[]` returned by `POST /agents/:id/export-ci` into the
 * artifact categories the Preview step lists (AC-2): the manifest, one file
 * per linked skill, the memory log, and the workflow file. Path conventions
 * mirror the manifest layout the `[API]` track generates:
 * `.devdigest/agents/<slug>.yaml`, `.devdigest/skills/<slug>.md`,
 * `.devdigest/memory.jsonl`, `.github/workflows/devdigest-review.yml`.
 */
export function categorizeFiles(files: CiFile[]): CategorizedFiles {
  const result: CategorizedFiles = { manifest: null, skills: [], memory: null, workflow: null };
  for (const file of files) {
    if (file.path.endsWith("memory.jsonl")) {
      result.memory = file;
    } else if (file.path.includes("/skills/") && file.path.endsWith(".md")) {
      result.skills.push(file);
    } else if (file.path.includes("/agents/") && /\.ya?ml$/.test(file.path)) {
      result.manifest = file;
    } else if (file.path.includes(".github/workflows/") || file.path.endsWith(".yml") || file.path.endsWith(".yaml")) {
      result.workflow = file;
    }
  }
  return result;
}

/** Converts the toggle state into the ordered trigger list the API expects. */
export function triggersToList(triggers: TriggerState): string[] {
  return (Object.keys(triggers) as (keyof TriggerState)[]).filter((key) => triggers[key]);
}

/** Replaces the workflow file's contents in-place, preserving the rest of the
 *  bundle — used when the maintainer edits the workflow textarea on Preview so
 *  the edit persists through Configure into Install. */
export function withEditedWorkflow(files: CiFile[], workflowPath: string, contents: string): CiFile[] {
  return files.map((file) => (file.path === workflowPath ? { ...file, contents } : file));
}

/**
 * Client-side re-check of the security invariants (AC-4) on a maintainer-
 * edited workflow before it's allowed to proceed to Install. This is a UX
 * guard only — the server MUST re-validate before committing (untrusted
 * input); this never blocks navigation for non-GHA targets (no workflow file).
 * Returns null when valid, or a user-facing error message.
 */
export function validateEditedWorkflow(contents: string | undefined): string | null {
  if (!contents) return null;
  if (/OPENROUTER_API_KEY\s*[:=]\s*["'][^"'$]/.test(contents) && !contents.includes("secrets.OPENROUTER_API_KEY")) {
    return "The workflow must reference the key via ${{ secrets.OPENROUTER_API_KEY }}, never an inlined value.";
  }
  if (/permissions:/.test(contents)) {
    const hasContentsRead = /contents:\s*read/.test(contents);
    const hasPrWrite = /pull-requests:\s*write/.test(contents);
    const hasWriteAll = /permissions:\s*write-all/.test(contents) || /contents:\s*write/.test(contents);
    if (hasWriteAll || !hasContentsRead || !hasPrWrite) {
      return "Permissions must stay exactly contents: read + pull-requests: write.";
    }
  }
  return null;
}

/** Rough byte size of the whole artifact bundle, for the zip degraded path's
 *  "file count + size estimate" (UTF-8 byte length, not display-string length). */
export function estimateBundleSize(files: CiFile[]): number {
  return files.reduce((sum, f) => sum + new TextEncoder().encode(f.contents).length, 0);
}

/** Formats a byte count as a short human string (e.g. "4.2 KB"). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
