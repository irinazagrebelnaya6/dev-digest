/* /skills/:id — Skill Editor. Left sidebar (skills list) + right editor with
   4 tabs: config, preview, stats, versions. Mirrors the /agents/:id pattern. */
"use client";

import React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Badge, Button, ErrorState, FormField, Icon, Markdown, Skeleton, Tabs, Textarea, Toggle } from "@devdigest/ui";
import { AppShell } from "../../../components/app-shell";
import {
  useSkill,
  useSkills,
  useSkillStats,
  useSkillVersions,
  useUpdateSkill,
  useRestoreSkillVersion,
} from "../../../lib/hooks/skills";
import { ApiError } from "../../../lib/api";
import { useToast } from "../../../lib/toast";
import type { SkillType } from "@devdigest/shared";

const TABS = [
  { key: "config", label: "Config", icon: "Settings" as const },
  { key: "preview", label: "Preview", icon: "Eye" as const },
  { key: "stats", label: "Stats", icon: "BarChart" as const },
  { key: "versions", label: "Versions", icon: "History" as const },
];

const TYPE_OPTIONS: Array<{ value: SkillType; label: string }> = [
  { value: "rubric", label: "Rubric" },
  { value: "convention", label: "Convention" },
  { value: "security", label: "Security" },
  { value: "custom", label: "Custom" },
];

export default function SkillEditorPage() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const { id } = params;

  const { data: skills } = useSkills();
  const { data: skill, isLoading, isError, error, refetch } = useSkill(id);
  const update = useUpdateSkill();
  const toast = useToast();

  const tab = TABS.some((t) => t.key === search.get("tab")) ? search.get("tab")! : "config";
  const setTab = (t: string) => {
    const sp = new URLSearchParams(search.toString());
    sp.set("tab", t);
    router.replace(`/skills/${id}?${sp.toString()}`);
  };

  const crumb = [
    { label: "Skills Lab" },
    { label: "Skills", href: "/skills" },
    { label: skill?.name ?? "Skill" },
  ];

  if (isError || (!isLoading && !skill)) {
    return (
      <AppShell crumb={crumb}>
        <ErrorState
          fullScreen
          title="Couldn't load this skill"
          body={error instanceof ApiError ? error.message : "The skill could not be loaded."}
          onRetry={() => refetch()}
        />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      <div style={{ display: "flex", height: "calc(100vh - 52px)" }}>
        {/* left: skills list */}
        <div
          style={{
            width: 260,
            flexShrink: 0,
            borderRight: "1px solid var(--border)",
            display: "flex",
            flexDirection: "column",
            background: "var(--bg-surface)",
            overflow: "auto",
          }}
        >
          <div style={{ padding: "16px 16px 8px", display: "flex", alignItems: "center", gap: 8 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, flex: 1 }}>Skills</h2>
            <Button kind="ghost" size="sm" onClick={() => router.push("/skills")}>
              All
            </Button>
          </div>
          <div style={{ padding: "0 8px 12px" }}>
            {(skills ?? []).map((sk) => (
              <div
                key={sk.id}
                onClick={() => router.push(`/skills/${sk.id}?tab=${tab}`)}
                style={{
                  padding: "8px 10px",
                  borderRadius: 6,
                  cursor: "pointer",
                  background: sk.id === id ? "var(--accent-muted)" : "transparent",
                  marginBottom: 2,
                }}
              >
                <div style={{ fontSize: 13, fontWeight: sk.id === id ? 600 : 400 }}>{sk.name}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{sk.type}</div>
              </div>
            ))}
          </div>
        </div>

        {/* editor */}
        {isLoading || !skill ? (
          <div style={{ flex: 1, padding: 28, display: "flex", flexDirection: "column", gap: 16 }}>
            <Skeleton height={24} width={240} />
            <Skeleton height={200} />
          </div>
        ) : (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
            {/* header */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 28px 0", flexShrink: 0 }}>
              <Icon.Zap size={18} style={{ color: "var(--accent)" }} />
              <h1 style={{ fontSize: 18, fontWeight: 700 }}>{skill.name}</h1>
              <Badge color="var(--text-secondary)">v{skill.version}</Badge>
              <Badge color="var(--text-secondary)">{skill.type}</Badge>
              {!skill.enabled && <Badge color="var(--text-muted)">disabled</Badge>}
            </div>
            {/* tabs */}
            <div style={{ borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
              <Tabs tabs={TABS} value={tab} onChange={setTab} pad="0 24px" />
            </div>
            <div style={{ flex: 1, overflow: "auto", padding: 28 }}>
              {tab === "config" && (
                <ConfigTab
                  skillId={id}
                  name={skill.name}
                  description={skill.description}
                  type={skill.type}
                  body={skill.body}
                  enabled={skill.enabled}
                  onSave={(patch) =>
                    update.mutateAsync({ id, patch }).then(() => toast.success("Saved")).catch(() => toast.error("Save failed"))
                  }
                  saving={update.isPending}
                />
              )}
              {tab === "preview" && <Markdown>{skill.body}</Markdown>}
              {tab === "stats" && <StatsTab skillId={id} />}
              {tab === "versions" && <VersionsTab skillId={id} currentVersion={skill.version} />}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

/* ---- Config tab ---- */

function ConfigTab({
  skillId,
  name,
  description,
  type,
  body,
  enabled,
  onSave,
  saving,
}: {
  skillId: string;
  name: string;
  description: string;
  type: SkillType;
  body: string;
  enabled: boolean;
  onSave: (patch: { name?: string; description?: string; type?: SkillType; body?: string; enabled?: boolean }) => void;
  saving: boolean;
}) {
  const [draftName, setDraftName] = React.useState(name);
  const [draftDesc, setDraftDesc] = React.useState(description);
  const [draftType, setDraftType] = React.useState<SkillType>(type);
  const [draftBody, setDraftBody] = React.useState(body);
  const [draftEnabled, setDraftEnabled] = React.useState(enabled);

  React.useEffect(() => {
    setDraftName(name);
    setDraftDesc(description);
    setDraftType(type);
    setDraftBody(body);
    setDraftEnabled(enabled);
  }, [skillId, name, description, type, body, enabled]);

  return (
    <div style={{ maxWidth: 560, display: "flex", flexDirection: "column", gap: 20 }}>
      <FormField label="Name">
        <input
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          style={{
            width: "100%",
            padding: "8px 10px",
            borderRadius: 6,
            border: "1px solid var(--border)",
            background: "var(--bg-input)",
            color: "var(--text)",
            fontSize: 14,
          }}
        />
      </FormField>

      <FormField label="Description">
        <input
          value={draftDesc}
          onChange={(e) => setDraftDesc(e.target.value)}
          style={{
            width: "100%",
            padding: "8px 10px",
            borderRadius: 6,
            border: "1px solid var(--border)",
            background: "var(--bg-input)",
            color: "var(--text)",
            fontSize: 14,
          }}
        />
      </FormField>

      <FormField label="Type">
        <select
          value={draftType}
          onChange={(e) => setDraftType(e.target.value as SkillType)}
          style={{
            padding: "8px 10px",
            borderRadius: 6,
            border: "1px solid var(--border)",
            background: "var(--bg-input)",
            color: "var(--text)",
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          {TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </FormField>

      <FormField
        label="Body (Markdown)"
        hint="Changing the body creates a new immutable version snapshot."
      >
        <Textarea value={draftBody} onChange={setDraftBody} rows={18} mono />
      </FormField>

      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 14 }}>Enabled</span>
        <Toggle on={draftEnabled} onChange={setDraftEnabled} size={14} />
      </div>

      <div>
        <Button
          kind="primary"
          onClick={() =>
            onSave({ name: draftName, description: draftDesc, type: draftType, body: draftBody, enabled: draftEnabled })
          }
          disabled={saving}
        >
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </div>
  );
}

/* ---- Stats tab ---- */

function StatsTab({ skillId }: { skillId: string }) {
  const { data: stats, isLoading } = useSkillStats(skillId);

  if (isLoading) return <Skeleton height={120} />;
  if (!stats) return <ErrorState body="Could not load stats." />;

  const items = [
    { label: "Agents using this skill", value: String(stats.agents_count) },
    { label: "Body versions", value: String(stats.version_count) },
    { label: "Created", value: new Date(stats.created_at).toLocaleDateString() },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 400 }}>
      {items.map((item) => (
        <div
          key={item.label}
          style={{
            display: "flex",
            justifyContent: "space-between",
            padding: "12px 16px",
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "var(--bg-surface)",
          }}
        >
          <span style={{ fontSize: 14, color: "var(--text-secondary)" }}>{item.label}</span>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{item.value}</span>
        </div>
      ))}
    </div>
  );
}

/* ---- Versions tab ---- */

function VersionsTab({ skillId, currentVersion }: { skillId: string; currentVersion: number }) {
  const { data: versions, isLoading } = useSkillVersions(skillId);
  const restore = useRestoreSkillVersion(skillId);
  const toast = useToast();

  if (isLoading) return <Skeleton height={160} />;
  if (!versions) return <ErrorState body="Could not load versions." />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 600 }}>
      {versions.map((v: import("../../../lib/hooks/skills").SkillVersionEntry) => (
        <div
          key={v.version}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "12px 16px",
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "var(--bg-surface)",
          }}
        >
          <div style={{ flex: 1 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>v{v.version}</span>
            {v.version === currentVersion && (
              <Badge color="var(--accent)" style={{ marginLeft: 8 }}>current</Badge>
            )}
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
              {new Date(v.created_at).toLocaleString()}
            </div>
          </div>
          {v.version !== currentVersion && (
            <Button
              kind="secondary"
              size="sm"
              disabled={restore.isPending}
              onClick={() =>
                restore.mutate(v.version, {
                  onSuccess: () => toast.success(`Restored to v${v.version}`),
                  onError: () => toast.error("Restore failed"),
                })
              }
            >
              Restore
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}