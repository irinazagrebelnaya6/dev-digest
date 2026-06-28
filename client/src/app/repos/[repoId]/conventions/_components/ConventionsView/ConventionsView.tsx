"use client";

import React from "react";
import { Button, EmptyState, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import { AppShell } from "../../../../../../components/app-shell";
import { useConventions, useExtractConventions } from "../../../../../../lib/hooks/conventions";
import { useActiveRepo } from "../../../../../../lib/repo-context";
import { CandidateCard } from "./_components/CandidateCard";
import { BuildSkillModal } from "./_components/BuildSkillModal";
import { useToast } from "../../../../../../lib/toast";
import { s } from "./styles";

export function ConventionsView({ repoId }: { repoId: string }) {
  const { activeRepo } = useActiveRepo();
  const { data: candidates, isLoading, isError, refetch } = useConventions(repoId);
  const extract = useExtractConventions();
  const toast = useToast();
  const [showRejected, setShowRejected] = React.useState(false);
  const [buildingSkill, setBuildingSkill] = React.useState(false);
  const [elapsed, setElapsed] = React.useState(0);

  React.useEffect(() => {
    if (!extract.isPending) { setElapsed(0); return; }
    setElapsed(0);
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [extract.isPending]);

  const repoName = activeRepo?.full_name ?? repoId;
  const all = candidates ?? [];
  const acceptedCount = all.filter((c) => c.status === "accepted").length;
  const filtered = showRejected ? all : all.filter((c) => c.status !== "rejected");

  const handleExtract = async () => {
    try {
      const result = await extract.mutateAsync({ repoId });
      toast.success(`Extracted ${result.kept} convention${result.kept !== 1 ? "s" : ""} (${result.dropped} dropped).`);
    } catch {
      toast.error("Extraction failed. Please try again.");
    }
  };

  return (
    <AppShell crumb={[{ label: repoName, mono: true }, { label: "Conventions" }]}>
      {buildingSkill && (
        <BuildSkillModal
          repoId={repoId}
          acceptedCount={acceptedCount}
          onClose={() => setBuildingSkill(false)}
        />
      )}

      <div style={s.page}>
        <div style={s.header}>
          <div style={s.headerText}>
            <h1 style={s.h1}>Conventions</h1>
            <p style={s.subtitle}>
              Coding conventions extracted from this repository.
              {all.length > 0 && ` ${acceptedCount} accepted, ${all.filter((c) => c.status === "rejected").length} rejected.`}
            </p>
          </div>

          <div style={s.headerActions}>
            {all.length > 0 && (
              <label style={s.showRejectedLabel}>
                <input
                  type="checkbox"
                  checked={showRejected}
                  onChange={(e) => setShowRejected(e.target.checked)}
                />
                Show rejected
              </label>
            )}
            <Button
              kind="ghost"
              size="sm"
              icon="RefreshCw"
              onClick={handleExtract}
              disabled={extract.isPending}
            >
              {extract.isPending ? "Running…" : "Re-extract"}
            </Button>
            <Button
              kind="primary"
              size="sm"
              icon="Zap"
              onClick={() => setBuildingSkill(true)}
              disabled={acceptedCount === 0}
            >
              Build skill ({acceptedCount})
            </Button>
          </div>
        </div>

        {extract.isPending && (
          <div style={s.extractBanner}>
            <Icon.RefreshCw size={14} />
            Extracting conventions from repository files… {elapsed}s
          </div>
        )}

        {isLoading && (
          <div style={s.grid}>
            <Skeleton height={160} />
            <Skeleton height={160} />
            <Skeleton height={160} />
          </div>
        )}

        {isError && (
          <ErrorState body="Could not load conventions." onRetry={() => refetch()} />
        )}

        {!isLoading && !isError && all.length === 0 && !extract.isPending && (
          <EmptyState
            icon="ListChecks"
            title="No conventions extracted yet"
            body="Run the extractor to analyse repository files and discover coding conventions."
            cta="Run Extractor"
            onCta={handleExtract}
          />
        )}

        {filtered.length > 0 && (
          <div style={s.grid}>
            {filtered.map((c) => (
              <CandidateCard
                key={c.id}
                candidate={c}
                repoId={repoId}
                repo={activeRepo}
              />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
