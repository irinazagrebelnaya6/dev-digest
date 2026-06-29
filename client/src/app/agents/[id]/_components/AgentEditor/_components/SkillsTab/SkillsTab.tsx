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

  const skillMap = React.useMemo(
    () => new Map((allSkills ?? []).map((s) => [s.id, s])),
    [allSkills],
  );

  const orderedLinks: AgentSkillLink[] = React.useMemo(
    () => [...(links ?? [])].sort((a, b) => a.order - b.order),
    [links],
  );

  const moveUp = (idx: number) => {
    if (idx === 0) return;
    const ids = orderedLinks.map((l) => l.skill_id);
    [ids[idx - 1], ids[idx]] = [ids[idx]!, ids[idx - 1]!];
    setSkills.mutate(ids, { onSuccess: () => toast.success("Order updated") });
  };

  const moveDown = (idx: number) => {
    if (idx === orderedLinks.length - 1) return;
    const ids = orderedLinks.map((l) => l.skill_id);
    [ids[idx], ids[idx + 1]] = [ids[idx + 1]!, ids[idx]!];
    setSkills.mutate(ids, { onSuccess: () => toast.success("Order updated") });
  };

  const remove = (skillId: string) => {
    const ids = orderedLinks.map((l) => l.skill_id).filter((id) => id !== skillId);
    setSkills.mutate(ids, { onSuccess: () => toast.success("Skill removed") });
  };

  const addSkill = (skillId: string): void => {
    const ids = [...orderedLinks.map((l) => l.skill_id), skillId];
    setSkills.mutate(ids, { onSuccess: () => toast.success("Skill linked") });
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
            return (
              <div key={link.skill_id} style={s.row}>
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
                    onClick={() => moveUp(idx)}
                    disabled={idx === 0 || setSkills.isPending}
                    aria-label="Move up"
                    style={s.iconBtn}
                  >
                    <Icon.ArrowUp size={14} />
                  </button>
                  <button
                    onClick={() => moveDown(idx)}
                    disabled={idx === orderedLinks.length - 1 || setSkills.isPending}
                    aria-label="Move down"
                    style={s.iconBtn}
                  >
                    <Icon.ArrowDown size={14} />
                  </button>
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
