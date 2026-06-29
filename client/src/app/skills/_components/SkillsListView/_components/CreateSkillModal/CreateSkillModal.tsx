"use client";

import React from "react";
import { Button, Modal, FormField, TextInput, SelectInput, Textarea } from "@devdigest/ui";
import type { SkillType } from "@devdigest/shared";
import { useCreateSkill } from "../../../../../../lib/hooks/skills";
import { useToast } from "../../../../../../lib/toast";

const TYPE_OPTIONS: { value: SkillType; label: string }[] = [
  { value: "rubric", label: "Rubric" },
  { value: "convention", label: "Convention" },
  { value: "security", label: "Security" },
  { value: "custom", label: "Custom" },
];

export function CreateSkillModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated?: (id: string) => void;
}) {
  const create = useCreateSkill();
  const toast = useToast();
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState<SkillType>("custom");
  const [body, setBody] = React.useState("");

  const submit = async () => {
    try {
      const skill = await create.mutateAsync({ name: name.trim() || "New skill", description, type, body });
      toast.success(`Created "${skill.name}"`);
      onClose();
      onCreated?.(skill.id);
    } catch {
      toast.error("Failed to create skill. Please try again.");
    }
  };

  return (
    <Modal
      width={600}
      title="Create skill"
      subtitle="Define a reusable instruction block for your review agents."
      onClose={onClose}
      footer={
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <Button kind="ghost" onClick={onClose}>Cancel</Button>
          <Button kind="primary" icon="Plus" onClick={submit} disabled={create.isPending}>
            {create.isPending ? "Creating…" : "Create skill"}
          </Button>
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <FormField label="Name" required>
          <TextInput value={name} onChange={setName} placeholder="e.g. test-anti-patterns" />
        </FormField>
        <FormField
          label="Description"
          hint="Describe what this skill does in one sentence. Written directively — this becomes the instruction to the agent."
        >
          <TextInput
            value={description}
            onChange={setDescription}
            placeholder="e.g. Flags tests that mock business logic instead of infrastructure."
          />
        </FormField>
        <FormField label="Type">
          <SelectInput
            value={type}
            onChange={(v) => setType(v as SkillType)}
            options={TYPE_OPTIONS}
          />
        </FormField>
        <FormField label="Body (Markdown)" hint="The full skill definition — rules, examples, anti-patterns.">
          <Textarea value={body} onChange={setBody} rows={10} mono placeholder="# Rule&#10;Describe the rule…" />
        </FormField>
      </div>
    </Modal>
  );
}
