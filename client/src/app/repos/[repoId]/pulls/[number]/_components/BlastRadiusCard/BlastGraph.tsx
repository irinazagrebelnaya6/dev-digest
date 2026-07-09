/* BlastGraph — the "Graph" view of the Blast Radius card. A dependency-free,
   CSP-safe inline SVG node-link diagram: changed symbols (left) linked to the
   files that call them (right). Caller nodes are links that open the code at
   the line (githubBlobUrl). Endpoints/crons render as pills under the graph. */
"use client";

import React from "react";
import { Badge } from "@devdigest/ui";
import type { BlastRadiusResponse } from "@devdigest/shared";
import { githubBlobUrl } from "@/lib/github-urls";

const EP = { color: "#5b9bd5", bg: "rgba(91,155,213,0.14)" };
const CRON = { color: "#c9962f", bg: "rgba(201,150,47,0.14)" };

const W = 600;
const PAD_Y = 16;
const ROW_H = 46;
const NODE_H = 30;
const LEFT_X = 8;
const LEFT_W = 176;
const RIGHT_W = 184;
const RIGHT_X = W - RIGHT_W - 8;

export function BlastGraph({
  downstream,
  repoFullName,
  headSha,
  emptyLabel,
}: {
  downstream: BlastRadiusResponse["downstream"];
  repoFullName: string | null;
  headSha: string;
  emptyLabel: string;
}) {
  const syms = downstream.filter((d) => d.callers.length > 0);

  // Unique caller files (with the earliest referenced line) + symbol→file edges.
  const fileIdx = new Map<string, number>();
  const files: { file: string; line: number }[] = [];
  const edges: Array<[number, number]> = [];
  syms.forEach((d, si) => {
    const seen = new Set<number>();
    for (const c of d.callers) {
      let fi = fileIdx.get(c.file);
      if (fi === undefined) {
        fi = files.length;
        fileIdx.set(c.file, fi);
        files.push({ file: c.file, line: c.line });
      } else {
        const rec = files[fi];
        if (rec && c.line < rec.line) rec.line = c.line;
      }
      if (!seen.has(fi)) {
        seen.add(fi);
        edges.push([si, fi]);
      }
    }
  });

  // Endpoints/crons (union across symbols) shown as pills below the graph.
  const endpoints = new Set<string>();
  const crons = new Set<string>();
  for (const d of syms) {
    for (const e of d.endpoints_affected) endpoints.add(e);
    for (const c of d.crons_affected) crons.add(c);
  }

  if (syms.length === 0) return <p style={{ fontSize: 13, color: "var(--text-muted)" }}>{emptyLabel}</p>;

  const rows = Math.max(syms.length, files.length);
  const H = PAD_Y * 2 + rows * ROW_H;
  const centerY = (i: number) => PAD_Y + i * ROW_H + NODE_H / 2;
  const base = (p: string) => p.split("/").pop() ?? p;
  const href = (f: string, line: number) =>
    repoFullName ? githubBlobUrl(repoFullName, headSha, f, line) : undefined;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="auto" role="img" aria-label="Blast radius graph" style={{ display: "block" }}>
        {/* edges */}
        {edges.map(([si, fi], k) => {
          const x1 = LEFT_X + LEFT_W;
          const y1 = centerY(si);
          const x2 = RIGHT_X;
          const y2 = centerY(fi);
          const mx = (x1 + x2) / 2;
          return (
            <path
              key={k}
              d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
              fill="none"
              stroke="var(--border)"
              strokeWidth={1.5}
            />
          );
        })}

        {/* changed-symbol nodes (left) */}
        {syms.map((d, i) => (
          <g key={`s${i}`}>
            <rect x={LEFT_X} y={PAD_Y + i * ROW_H} width={LEFT_W} height={NODE_H} rx={6}
              fill="var(--bg-elevated)" stroke="var(--accent-text)" strokeWidth={1} />
            <text x={LEFT_X + 12} y={centerY(i) + 4} fontFamily="var(--font-mono, monospace)" fontSize={12.5} fontWeight={700} fill="var(--text-primary)">
              {d.symbol}()
            </text>
          </g>
        ))}

        {/* caller-file nodes (right, clickable) */}
        {files.map((f, j) => {
          const node = (
            <g>
              <rect x={RIGHT_X} y={PAD_Y + j * ROW_H} width={RIGHT_W} height={NODE_H} rx={6}
                fill="var(--bg-elevated)" stroke="var(--border)" strokeWidth={1} />
              <text x={RIGHT_X + 12} y={centerY(j) + 4} fontFamily="var(--font-mono, monospace)" fontSize={12} fill="var(--text-secondary)">
                {base(f.file)}:{f.line}
              </text>
              <title>{`${f.file}:${f.line}`}</title>
            </g>
          );
          const link = href(f.file, f.line);
          return (
            <a key={`f${j}`} href={link} target="_blank" rel="noopener noreferrer">
              {node}
            </a>
          );
        })}
      </svg>

      {(endpoints.size > 0 || crons.size > 0) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
          {[...endpoints].map((e) => (
            <Badge key={e} icon="Globe" color={EP.color} bg={EP.bg} style={{ border: `1px solid ${EP.color}` }}>
              {e}
            </Badge>
          ))}
          {[...crons].map((c) => (
            <Badge key={c} icon="Clock" color={CRON.color} bg={CRON.bg} style={{ border: `1px solid ${CRON.color}` }}>
              {c}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
