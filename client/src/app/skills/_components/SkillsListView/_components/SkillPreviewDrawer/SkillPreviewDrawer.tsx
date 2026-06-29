"use client";

import React from "react";
import { Button, Drawer, Markdown, Badge, Toggle, FormField, Textarea } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useUpdateSkill } from "../../../../../../lib/hooks/skills";
import { useToast } from "../../../../../../lib/toast";
import { TYPE_BADGE_COLOR } from "../../constants";

export function SkillPreviewDrawer({
  skill,
  onClose,
}: {
  skill: Skill;
  onClose: () => void;
}) {
  const update = useUpdateSkill();
  const toast = useToast();
  const [editing, setEditing] = React.useState(false);
  const [body, setBody] = React.useState(skill.body);
  const color = TYPE_BADGE_COLOR[skill.type] ?? "var(--text-secondary)";

  const saveBody = async () => {
    try {
      await update.mutateAsync({ id: skill.id, patch: { body } });
      toast.success(`Saved "${skill.name}" (v${skill.version + 1})`);
      setEditing(false);
    } catch {
      toast.error("Failed to save skill body. Please try again.");
    }
  };

  return (
    <Drawer
      width={640}
      title={skill.name}
      subtitle={skill.description || undefined}
      onClose={onClose}
      footer={
        editing ? (
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <Button kind="ghost" onClick={() => { setBody(skill.body); setEditing(false); }}>
              Cancel
            </Button>
            <Button kind="primary" onClick={saveBody} disabled={update.isPending}>
              {update.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <Button kind="ghost" icon="Edit" onClick={() => setEditing(true)}>
              Edit body
            </Button>
          </div>
        )
      }
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color,
            background: color + "1a",
            padding: "2px 8px",
            borderRadius: 4,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
          }}
        >
          {skill.type}
        </span>
        <Badge color="var(--text-secondary)">v{skill.version}</Badge>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            {skill.enabled ? "Enabled" : "Disabled"}
          </span>
          <Toggle
            on={skill.enabled}
            onChange={(enabled) => update.mutate({ id: skill.id, patch: { enabled } })}
            size={14}
          />
        </div>
      </div>

      {editing ? (
        <FormField label="Skill body (Markdown)" hint="Saving a changed body creates a new immutable version.">
          <Textarea value={body} onChange={setBody} rows={20} mono />
        </FormField>
      ) : (
        <Markdown>{skill.body}</Markdown>
      )}
    </Drawer>
  );
}
