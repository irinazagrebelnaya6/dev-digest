"use client";

import React from "react";
import { Button, Modal, FormField, SelectInput, TextInput, Textarea } from "@devdigest/ui";
import type { ConventionCandidate } from "@devdigest/shared";
import { useAgents } from "../../../../../../../../lib/hooks/agents";
import { useConventions, useBuildConventionsSkill } from "../../../../../../../../lib/hooks/conventions";
import { useToast } from "../../../../../../../../lib/toast";

function renderSkillBody(candidates: ConventionCandidate[]): string {
  if (candidates.length === 0) return "# repo-conventions\n\nNo conventions accepted yet.";
  const groups = new Map<string, ConventionCandidate[]>();
  for (const c of candidates) {
    const cat = c.category ?? "General";
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat)!.push(c);
  }
  const lines: string[] = ["# repo-conventions", ""];
  for (const [category, items] of groups) {
    lines.push(`## ${category}`, "");
    for (const c of items) {
      const evidence = c.evidence_path
        ? `  (evidence: \`${c.evidence_path}${c.evidence_line ? `:${c.evidence_line}` : ""}\`)`
        : "";
      lines.push(`- ${c.rule}${evidence}`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

export function BuildSkillModal({
  repoId,
  acceptedCount,
  onClose,
}: {
  repoId: string;
  acceptedCount: number;
  onClose: () => void;
}) {
  const { data: agents } = useAgents();
  const { data: candidates } = useConventions(repoId);
  const build = useBuildConventionsSkill();
  const toast = useToast();

  const accepted = React.useMemo(
    () => (candidates ?? []).filter((c) => c.status === "accepted"),
    [candidates],
  );

  const [agentId, setAgentId] = React.useState<string>("");
  const [name, setName] = React.useState("repo-conventions");
  const [description, setDescription] = React.useState(
    "Coding conventions extracted from the repository.",
  );
  const [body, setBody] = React.useState(() => renderSkillBody(accepted));

  // Sync body preview when accepted list changes (e.g. user goes back and accepts more)
  React.useEffect(() => {
    setBody(renderSkillBody(accepted));
  }, [accepted]);

  const agentOptions = [
    { value: "", label: "None — create skill only" },
    ...(agents ?? []).map((a) => ({ value: a.id, label: a.name })),
  ];

  const submit = async () => {
    try {
      const result = await build.mutateAsync({
        repoId,
        agentId: agentId || undefined,
        name: name.trim() || undefined,
        description: description.trim() || undefined,
        body: body.trim() || undefined,
      });
      const msg = result.linked
        ? `Skill "${result.skill.name}" created and linked to agent.`
        : `Skill "${result.skill.name}" created.`;
      toast.success(msg);
      onClose();
    } catch {
      toast.error("Failed to build skill. Please try again.");
    }
  };

  return (
    <Modal
      width={640}
      title="Build conventions skill"
      subtitle={`Converts ${acceptedCount} accepted candidate${acceptedCount !== 1 ? "s" : ""} into a reusable skill.`}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <Button kind="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button kind="primary" icon="Zap" onClick={submit} disabled={build.isPending}>
            {build.isPending ? "Building…" : "Build skill"}
          </Button>
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <FormField label="Skill name">
          <TextInput value={name} onChange={setName} placeholder="repo-conventions" />
        </FormField>

        <FormField label="Description">
          <TextInput
            value={description}
            onChange={setDescription}
            placeholder="Short description of what this skill does"
          />
        </FormField>

        <FormField
          label="Skill body"
          hint="Markdown text injected into the agent's context. Edit to adjust before saving."
        >
          <Textarea
            value={body}
            onChange={setBody}
            rows={12}
            placeholder="# repo-conventions&#10;&#10;## naming&#10;..."
          />
        </FormField>

        <FormField
          label="Link to agent (optional)"
          hint="The skill will be appended to the agent's linked skills."
        >
          <SelectInput value={agentId} onChange={setAgentId} options={agentOptions} />
        </FormField>
      </div>
    </Modal>
  );
}