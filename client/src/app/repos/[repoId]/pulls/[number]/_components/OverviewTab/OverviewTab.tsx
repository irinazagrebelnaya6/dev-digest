"use client";

import React from "react";
import { SectionLabel } from "@devdigest/ui";
import { IntentCard } from "../IntentCard";
import { PrBriefCard } from "../PrBriefCard";
import { RiskAreasCard } from "../RiskAreasCard";
import { BlastRadiusCard } from "../BlastRadiusCard";
import { s } from "./styles";

interface OverviewTabProps {
  prBody: string | null | undefined;
  prId: string | null;
  repoFullName: string | null;
  headSha: string;
}

export function OverviewTab({ prBody, prId, repoFullName, headSha }: OverviewTabProps) {
  return (
    <>
      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">Description</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
      {/* Two columns: Intent + Risk Areas on the left, Blast Radius on the right. */}
      <div style={s.grid}>
        <div style={s.col}>
          {prId && <IntentCard prId={prId} />}
          {prId && <PrBriefCard prId={prId} repoFullName={repoFullName} headSha={headSha} />}
          {prId && <RiskAreasCard prId={prId} />}
        </div>
        <div style={s.col}>
          {prId && <BlastRadiusCard prId={prId} repoFullName={repoFullName} headSha={headSha} />}
        </div>
      </div>
    </>
  );
}
