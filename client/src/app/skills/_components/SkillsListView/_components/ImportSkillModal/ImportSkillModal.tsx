"use client";

import React from "react";
import { Button, Modal, FormField, TextInput, SelectInput, Textarea } from "@devdigest/ui";
import type { SkillType } from "@devdigest/shared";
import { useCreateSkill } from "../../../../../../lib/hooks/skills";
import { parseSkillMarkdown } from "../../../../../../lib/parse-skill-frontmatter";
import { useToast } from "../../../../../../lib/toast";

const TYPE_OPTIONS: { value: SkillType; label: string }[] = [
  { value: "rubric", label: "Rubric" },
  { value: "convention", label: "Convention" },
  { value: "security", label: "Security" },
  { value: "custom", label: "Custom" },
];

async function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve((e.target?.result as string) ?? "");
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

async function extractMdFromZip(file: File): Promise<string | null> {
  // Minimal ZIP parser: read raw bytes, find the first .md local file entry.
  // ZIP local file header signature: PK\x03\x04
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const dec = new TextDecoder("utf-8", { fatal: false });

  let i = 0;
  while (i < bytes.length - 30) {
    // Local file header: PK (0x50 0x4B) 0x03 0x04
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x03 && bytes[i + 3] === 0x04) {
      const fnLen = bytes[i + 26]! | (bytes[i + 27]! << 8);
      const extraLen = bytes[i + 28]! | (bytes[i + 29]! << 8);
      const compressedSize = bytes[i + 18]! | (bytes[i + 19]! << 8) | (bytes[i + 20]! << 16) | (bytes[i + 21]! << 24);
      const compressionMethod = bytes[i + 8]! | (bytes[i + 9]! << 8);
      const fnStart = i + 30;
      const fnEnd = fnStart + fnLen;
      const fileName = dec.decode(bytes.slice(fnStart, fnEnd));
      const dataStart = fnEnd + extraLen;

      if (fileName.endsWith(".md") && compressionMethod === 0 && compressedSize > 0) {
        return dec.decode(bytes.slice(dataStart, dataStart + compressedSize));
      }
      i = dataStart + compressedSize;
    } else {
      i++;
    }
  }
  return null;
}

export function ImportSkillModal({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported?: (id: string) => void;
}) {
  const create = useCreateSkill();
  const toast = useToast();
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState<SkillType>("custom");
  const [body, setBody] = React.useState("");
  const [parsed, setParsed] = React.useState(false);
  const [fileError, setFileError] = React.useState<string | null>(null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileError(null);

    let text: string | null = null;

    if (file.name.endsWith(".md")) {
      text = await readFileText(file);
    } else if (file.name.endsWith(".zip")) {
      text = await extractMdFromZip(file);
      if (!text) {
        setFileError("No .md file found in archive (only uncompressed entries are supported).");
        return;
      }
    } else {
      setFileError("Only .md and .zip files are supported.");
      return;
    }

    const parsed = parseSkillMarkdown(text);
    if (parsed.name) setName(parsed.name);
    if (parsed.description) setDescription(parsed.description);
    if (parsed.type) setType(parsed.type);
    setBody(parsed.body);
    setParsed(true);
  };

  const submit = async () => {
    try {
      const skill = await create.mutateAsync({
        name: name.trim() || "Imported skill",
        description,
        type,
        source: "community",
        body,
      });
      toast.success(`Imported "${skill.name}"`);
      onClose();
      onImported?.(skill.id);
    } catch {
      toast.error("Failed to import skill. Please try again.");
    }
  };

  return (
    <Modal
      width={640}
      title="Import skill from file"
      subtitle="Upload a .md or .zip containing a skill definition."
      onClose={onClose}
      footer={
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <Button kind="ghost" onClick={onClose}>Cancel</Button>
          <Button
            kind="primary"
            icon="Upload"
            onClick={submit}
            disabled={!parsed || create.isPending}
          >
            {create.isPending ? "Importing…" : "Import skill"}
          </Button>
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <FormField label="File (.md or .zip)" required>
          <input
            type="file"
            accept=".md,.zip"
            onChange={handleFile}
            style={{ fontSize: 13, color: "var(--text-primary)" }}
          />
          {fileError && (
            <p style={{ fontSize: 12, color: "var(--crit)", marginTop: 4 }}>{fileError}</p>
          )}
        </FormField>

        {parsed && (
          <>
            <FormField label="Name" required>
              <TextInput value={name} onChange={setName} placeholder="Skill name" />
            </FormField>
            <FormField
              label="Description"
              hint="Describe what this skill does in one sentence. Written directively — this becomes the instruction to the agent."
            >
              <TextInput value={description} onChange={setDescription} placeholder="e.g. Flags tests that mock business logic." />
            </FormField>
            <FormField label="Type">
              <SelectInput value={type} onChange={(v) => setType(v as SkillType)} options={TYPE_OPTIONS} />
            </FormField>
            <FormField label="Body (preview)" hint="You may edit before importing.">
              <Textarea value={body} onChange={setBody} rows={12} mono />
            </FormField>
            <div
              style={{
                padding: "10px 14px",
                borderRadius: 7,
                background: "var(--warn-bg, #fef9c3)",
                border: "1px solid var(--warn, #ca8a04)",
                fontSize: 13,
                color: "var(--warn-text, #713f12)",
              }}
            >
              ⚠️ This skill will be injected as instructions into your agent&apos;s prompt. Only import skills you trust.
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
