"use client";

import React from "react";
import { Icon, Toggle } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useDeleteSkill } from "../../../../../../lib/hooks/skills";
import { TYPE_BADGE_COLOR } from "../../constants";
import { s } from "./styles";

export function SkillCard({
  skill,
  active,
  onClick,
  onToggle,
}: {
  skill: Skill;
  active?: boolean;
  onClick?: () => void;
  onToggle?: (enabled: boolean) => void;
}) {
  const del = useDeleteSkill();
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const color = TYPE_BADGE_COLOR[skill.type] ?? "var(--text-secondary)";

  return (
    <div onClick={onClick} style={s.card(!!active, skill.enabled)}>
      <div style={s.headerRow}>
        <div style={s.iconBox}>
          <Icon.Zap size={15} />
        </div>
        <span style={s.name}>{skill.name}</span>
        {onToggle && (
          <div onClick={(e) => e.stopPropagation()}>
            <Toggle on={skill.enabled} onChange={onToggle} size={14} />
          </div>
        )}
        {confirmDelete ? (
          <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button
              onClick={() => del.mutate(skill.id, { onSettled: () => setConfirmDelete(false) })}
              disabled={del.isPending}
              style={{ fontSize: 11, fontWeight: 600, color: "var(--crit)", background: "none", border: "none", cursor: "pointer", padding: "2px 4px" }}
            >
              {del.isPending ? "…" : "Delete"}
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              style={{ fontSize: 11, color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer", padding: "2px 4px" }}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); }}
            disabled={del.isPending}
            title="Delete skill"
            aria-label="Delete skill"
            style={{
              background: "none",
              border: "none",
              cursor: del.isPending ? "not-allowed" : "pointer",
              color: "var(--text-muted)",
              display: "inline-flex",
              padding: 4,
            }}
          >
            <Icon.Trash size={14} />
          </button>
        )}
      </div>
      <div style={s.description}>{skill.description || "No description"}</div>
      <div style={s.metaRow}>
        <span style={s.typeBadge(color)}>{skill.type}</span>
      </div>
    </div>
  );
}
