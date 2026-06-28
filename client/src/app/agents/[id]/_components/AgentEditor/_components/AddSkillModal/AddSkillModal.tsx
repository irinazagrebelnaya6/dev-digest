"use client";

import React from "react";
import { Button, Modal, Icon } from "@devdigest/ui";
import { useSkills } from "../../../../../../../lib/hooks/skills";
import { TYPE_BADGE_COLOR } from "../../../../../../skills/_components/SkillsListView/constants";

export function AddSkillModal({
  excludeIds,
  onAdd,
  onClose,
}: {
  excludeIds: Set<string>;
  onAdd: (skillId: string) => void;
  onClose: () => void;
}) {
  const { data: skills, isLoading } = useSkills();
  const [search, setSearch] = React.useState("");

  const available = (skills ?? []).filter(
    (s) => !excludeIds.has(s.id) && (
      !search.trim() ||
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.type.toLowerCase().includes(search.toLowerCase())
    ),
  );

  return (
    <Modal
      width={480}
      title="Add skill"
      subtitle="Pick a skill from your workspace to link to this agent."
      onClose={onClose}
      footer={
        <Button kind="ghost" onClick={onClose}>Cancel</Button>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-surface)" }}>
          <Icon.Search size={13} style={{ color: "var(--text-muted)" }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter skills…"
            style={{ flex: 1, fontSize: 13, background: "transparent", border: "none", outline: "none", color: "var(--text-primary)" }}
            autoFocus
          />
        </div>

        {isLoading && <div style={{ fontSize: 13, color: "var(--text-muted)", padding: "8px 0" }}>Loading…</div>}

        {!isLoading && available.length === 0 && (
          <div style={{ fontSize: 13, color: "var(--text-muted)", padding: "8px 0" }}>
            {(skills ?? []).length === 0 ? "No skills in workspace yet." : "All skills are already linked."}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 320, overflow: "auto" }}>
          {available.map((skill) => {
            const color = TYPE_BADGE_COLOR[skill.type] ?? "var(--text-secondary)";
            return (
              <button
                key={skill.id}
                onClick={() => onAdd(skill.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "9px 12px",
                  borderRadius: 7,
                  border: "1px solid var(--border)",
                  background: "var(--bg-elevated)",
                  cursor: "pointer",
                  textAlign: "left",
                  width: "100%",
                }}
              >
                <div style={{ width: 22, height: 22, borderRadius: 6, background: "var(--accent-bg)", color: "var(--accent)", display: "grid", placeItems: "center", flexShrink: 0 }}>
                  <Icon.Zap size={12} />
                </div>
                <span style={{ fontSize: 14, fontWeight: 500, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {skill.name}
                </span>
                <span style={{ fontSize: 11, fontWeight: 600, color, background: color + "1a", padding: "2px 7px", borderRadius: 4, textTransform: "uppercase", letterSpacing: "0.04em", flexShrink: 0 }}>
                  {skill.type}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
