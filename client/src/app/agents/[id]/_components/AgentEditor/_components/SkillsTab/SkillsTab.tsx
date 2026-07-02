"use client";

import React from "react";
import { Button, EmptyState, ErrorState, Icon, Skeleton, Toggle } from "@devdigest/ui";
import type { Agent, AgentSkillLink } from "@devdigest/shared";
import { useAgentSkills, useSetAgentSkills, useSkills, useUpdateSkill } from "../../../../../../../lib/hooks/skills";
import { useToast } from "../../../../../../../lib/toast";
import { AddSkillModal } from "../AddSkillModal";
import { s } from "./styles";

export function SkillsTab({ agent }: { agent: Agent }) {
  const toast = useToast();
  const { data: links, isLoading, isError } = useAgentSkills(agent.id);
  const { data: allSkills } = useSkills();
  const setSkills = useSetAgentSkills(agent.id);
  const updateSkill = useUpdateSkill();
  const [adding, setAdding] = React.useState(false);
  const dragIdx = React.useRef<number | null>(null);
  const [dragOver, setDragOver] = React.useState<number | null>(null);

  const skillMap = React.useMemo(
    () => new Map((allSkills ?? []).map((s) => [s.id, s])),
    [allSkills],
  );

  const orderedLinks: AgentSkillLink[] = React.useMemo(
    () => [...(links ?? [])].sort((a, b) => a.order - b.order),
    [links],
  );

  const remove = (skillId: string) => {
    const ids = orderedLinks.map((l) => l.skill_id).filter((id) => id !== skillId);
    setSkills.mutate(ids, { onSuccess: () => toast.success("Skill removed") });
  };

  const addSkill = (skillId: string): void => {
    const ids = [...orderedLinks.map((l) => l.skill_id), skillId];
    setSkills.mutate(ids, { onSuccess: () => toast.success("Skill linked") });
  };

  const handleDragStart = (idx: number) => { dragIdx.current = idx; };

  const handleDrop = (toIdx: number) => {
    const from = dragIdx.current;
    dragIdx.current = null;
    setDragOver(null);
    if (from === null || from === toIdx) return;
    const ids = orderedLinks.map((l) => l.skill_id);
    const [moved] = ids.splice(from, 1);
    ids.splice(toIdx, 0, moved!);
    setSkills.mutate(ids, { onSuccess: () => toast.success("Order updated") });
  };

  if (isLoading) return <div style={s.wrap}><Skeleton height={80} /><Skeleton height={80} /></div>;
  if (isError) return <ErrorState body="Could not load linked skills." />;

  const linkedIds = new Set(orderedLinks.map((l) => l.skill_id));

  return (
    <div style={s.wrap}>
      {adding && (
        <AddSkillModal
          excludeIds={linkedIds}
          onAdd={(id) => { addSkill(id); setAdding(false); }}
          onClose={() => setAdding(false)}
        />
      )}

      <div style={s.header}>
        <div>
          <div style={s.title}>Skills</div>
          <div style={s.hint}>Order matters — earlier skills appear earlier in the assembled prompt.</div>
        </div>
        <Button kind="primary" size="sm" icon="Plus" onClick={() => setAdding(true)}>
          Add skill
        </Button>
      </div>

      {orderedLinks.length === 0 && (
        <EmptyState
          icon="Zap"
          title="No skills linked"
          body="Add a skill to extend this agent's instructions."
          cta="Add skill"
          onCta={() => setAdding(true)}
        />
      )}

      {orderedLinks.length > 0 && (
        <div style={s.list}>
          {orderedLinks.map((link, idx) => {
            const skill = skillMap.get(link.skill_id);
            if (!skill) return null;
            const isOver = dragOver === idx;
            return (
              <div
                key={link.skill_id}
                draggable
                onDragStart={() => handleDragStart(idx)}
                onDragOver={(e) => { e.preventDefault(); setDragOver(idx); }}
                onDragLeave={() => setDragOver(null)}
                onDrop={() => handleDrop(idx)}
                style={{
                  ...s.row,
                  outline: isOver ? "2px solid var(--accent)" : undefined,
                  opacity: dragIdx.current === idx ? 0.5 : 1,
                  cursor: "grab",
                }}
              >
                <Icon.Menu size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                <div style={s.order}>{idx + 1}</div>
                <div style={s.info}>
                  <span style={s.name}>{skill.name}</span>
                  <span style={s.type}>{skill.type}</span>
                </div>
                <div style={s.actions}>
                  <Toggle
                    on={skill.enabled}
                    size={13}
                    onChange={() =>
                      updateSkill.mutate(
                        { id: skill.id, patch: { enabled: !skill.enabled } },
                        { onSuccess: () => toast.success(skill.enabled ? "Skill disabled" : "Skill enabled") },
                      )
                    }
                  />
                  <button
                    onClick={() => remove(link.skill_id)}
                    disabled={setSkills.isPending}
                    aria-label="Remove skill"
                    style={{ ...s.iconBtn, color: "var(--text-muted)" }}
                  >
                    <Icon.X size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
