"use client";

import React from "react";
import { Icon } from "@devdigest/ui";
import type { ConventionCandidate, Repo } from "@devdigest/shared";
import { useUpdateConventionStatus } from "../../../../../../../../lib/hooks/conventions";
import { s } from "./styles";

const CATEGORY_COLORS: Record<string, string> = {
  naming: "var(--blue, #60a5fa)",
  imports: "var(--purple, #a78bfa)",
  "error-handling": "var(--crit, #ef4444)",
  testing: "var(--green, #22c55e)",
  types: "var(--amber, #f59e0b)",
};

function categoryColor(cat: string | null | undefined): string {
  if (!cat) return "var(--text-secondary)";
  return CATEGORY_COLORS[cat.toLowerCase()] ?? "var(--text-secondary)";
}

function buildEvidenceUrl(
  repo: Repo | null,
  path: string | null | undefined,
  line: number | null | undefined,
): string | null {
  if (!repo || !path) return null;
  const base = `https://github.com/${repo.owner}/${repo.name}/blob/${repo.default_branch}/${path}`;
  return line ? `${base}#L${line}` : base;
}

export function CandidateCard({
  candidate,
  repoId,
  repo,
}: {
  candidate: ConventionCandidate;
  repoId: string;
  repo: Repo | null;
}) {
  const update = useUpdateConventionStatus();
  const pct = Math.round((candidate.confidence ?? 0) * 100);
  const evidenceUrl = buildEvidenceUrl(repo, candidate.evidence_path, candidate.evidence_line);
  const color = categoryColor(candidate.category);

  const [editing, setEditing] = React.useState(false);
  const [draftRule, setDraftRule] = React.useState(candidate.rule);
  const [draftCategory, setDraftCategory] = React.useState(candidate.category ?? "");

  const setStatus = (status: "accepted" | "rejected" | "pending") => {
    update.mutate({ id: candidate.id, status, repoId });
  };

  const startEdit = () => {
    setDraftRule(candidate.rule);
    setDraftCategory(candidate.category ?? "");
    setEditing(true);
  };

  const cancelEdit = () => setEditing(false);

  const saveEdit = async () => {
    try {
      await update.mutateAsync({
        id: candidate.id,
        rule: draftRule.trim() || candidate.rule,
        category: draftCategory.trim() || undefined,
        repoId,
      });
      setEditing(false);
    } catch {
      // Global mutationCache.onError in providers.tsx already shows the error toast.
      // Catch here only to prevent unhandled rejection and keep edit mode open.
    }
  };

  return (
    <div style={s.card(candidate.status)}>
      {editing ? (
        <div style={s.editRow}>
          <textarea
            style={s.editTextarea}
            value={draftRule}
            onChange={(e) => setDraftRule(e.target.value)}
            placeholder="Convention rule…"
            autoFocus
          />
          <input
            style={s.editCategoryInput}
            value={draftCategory}
            onChange={(e) => setDraftCategory(e.target.value)}
            placeholder="category"
          />
          <div style={s.editActions}>
            <button
              style={s.actionBtn("reset", false)}
              onClick={cancelEdit}
              disabled={update.isPending}
            >
              Cancel
            </button>
            <button
              style={s.actionBtn("accept", false)}
              onClick={saveEdit}
              disabled={update.isPending || !draftRule.trim()}
            >
              {update.isPending ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div style={s.headerRow}>
            {candidate.category && (
              <span style={s.categoryBadge(color)}>{candidate.category}</span>
            )}
            <span style={s.rule}>{candidate.rule}</span>
            <button style={s.editBtn} onClick={startEdit} title="Edit rule">
              <Icon.Edit size={13} />
            </button>
          </div>

          {evidenceUrl && (
            <div style={s.evidenceRow}>
              <Icon.File size={12} />
              <a
                href={evidenceUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={s.evidenceLink}
                title={`${candidate.evidence_path}${candidate.evidence_line ? `:${candidate.evidence_line}` : ""}`}
              >
                {candidate.evidence_path}
                {candidate.evidence_line ? `:${candidate.evidence_line}` : ""}
              </a>
            </div>
          )}

          <div style={s.confidenceRow}>
            <div style={s.confidenceBar}>
              <div style={s.confidenceFill(pct)} />
            </div>
            <span style={s.confidencePct}>{pct}%</span>
          </div>

          <div style={s.actionRow}>
            {candidate.status !== "pending" && (
              <button
                style={s.actionBtn("reset", false)}
                onClick={() => setStatus("pending")}
                disabled={update.isPending}
              >
                Reset
              </button>
            )}
            <button
              style={s.actionBtn("reject", candidate.status === "rejected")}
              onClick={() => setStatus(candidate.status === "rejected" ? "pending" : "rejected")}
              disabled={update.isPending}
            >
              Reject
            </button>
            <button
              style={s.actionBtn("accept", candidate.status === "accepted")}
              onClick={() => setStatus(candidate.status === "accepted" ? "pending" : "accepted")}
              disabled={update.isPending}
            >
              Accept
            </button>
          </div>
        </>
      )}
    </div>
  );
}