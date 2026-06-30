"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Button, Dropdown, EmptyState, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import { AppShell } from "../../../../components/app-shell";
import { useSkills, useUpdateSkill } from "../../../../lib/hooks/skills";
import { SkillCard } from "./_components/SkillCard";
import { CreateSkillModal } from "./_components/CreateSkillModal";
import { ImportSkillModal } from "./_components/ImportSkillModal";
import { filterSkills } from "./helpers";
import { s } from "./styles";

export function SkillsListView() {
  const router = useRouter();
  const { data: skills, isLoading, isError, refetch } = useSkills();
  const update = useUpdateSkill();
  const [search, setSearch] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [importing, setImporting] = React.useState(false);

  const list = filterSkills(skills ?? [], search);

  return (
    <AppShell crumb={[{ label: "Skills Lab" }, { label: "Skills" }]}>
      {creating && <CreateSkillModal onClose={() => setCreating(false)} />}
      {importing && <ImportSkillModal onClose={() => setImporting(false)} />}

      <div style={s.page}>
        <div style={s.header}>
          <div style={s.headerText}>
            <h1 style={s.h1}>Skills</h1>
            <p style={s.subtitle}>Reusable instruction blocks attached to your review agents.</p>
          </div>
          <div style={s.search}>
            <Icon.Search size={13} style={s.searchIcon} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search skills…"
              style={s.searchInput}
            />
          </div>
          <Dropdown
            width={200}
            align="right"
            trigger={
              <Button kind="primary" size="sm" icon="Plus" iconRight="ChevronDown">
                Add Skill
              </Button>
            }
            items={[
              { label: "Create skill", icon: "Edit", onClick: () => setCreating(true) },
              { divider: true },
              { label: "Import from file", icon: "Upload", onClick: () => setImporting(true) },
            ]}
          />
        </div>

        {isLoading && (
          <div style={s.grid}>
            <Skeleton height={110} />
            <Skeleton height={110} />
            <Skeleton height={110} />
          </div>
        )}
        {isError && <ErrorState body="Could not load skills." onRetry={() => refetch()} />}
        {!isLoading && !isError && list.length === 0 && (
          <EmptyState
            icon="Zap"
            title="No skills yet"
            body="Import a skill from a file or create one from scratch."
            cta="Import from file"
            onCta={() => setImporting(true)}
          />
        )}
        {list.length > 0 && (
          <div style={s.grid}>
            {list.map((sk) => (
              <SkillCard
                key={sk.id}
                skill={sk}
                onClick={() => router.push(`/skills/${sk.id}`)}
                onToggle={(enabled: boolean) => update.mutate({ id: sk.id, patch: { enabled } })}
              />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
