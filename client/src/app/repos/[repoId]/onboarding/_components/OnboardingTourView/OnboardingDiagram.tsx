/* OnboardingDiagram — inline SVG renderer for the `architecture` section's
   node/edge JSON diagram (D7). Dependency-free and CSP-safe (no mermaid
   runtime), modelled on BlastGraph.tsx (pulls/[number]/_components/
   BlastRadiusCard/BlastGraph.tsx). Nodes are laid out in a wrapped grid;
   edges are drawn as curved connectors between node centers with an
   arrowhead + optional label. A `null`/malformed diagram (or one with zero
   nodes) renders nothing — the section body still renders around it (AC-13). */
"use client";

import React from "react";
import type { OnboardingDiagram as OnboardingDiagramT } from "@devdigest/shared";

const NODE_W = 148;
const NODE_H = 40;
const GAP_X = 40;
const GAP_Y = 56;
const PAD = 16;

export function OnboardingDiagram({ diagram }: { diagram: OnboardingDiagramT | null | undefined }) {
  const nodes = diagram?.nodes ?? [];
  if (nodes.length === 0) return null;

  const cols = Math.max(1, Math.min(nodes.length, Math.ceil(Math.sqrt(nodes.length * 1.6))));
  const rows = Math.ceil(nodes.length / cols);
  const W = PAD * 2 + cols * NODE_W + (cols - 1) * GAP_X;
  const H = PAD * 2 + rows * NODE_H + (rows - 1) * GAP_Y;

  const centerOf = new Map<string, { x: number; y: number }>();
  nodes.forEach((n, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = PAD + col * (NODE_W + GAP_X) + NODE_W / 2;
    const y = PAD + row * (NODE_H + GAP_Y) + NODE_H / 2;
    centerOf.set(n.id, { x, y });
  });

  // Drop edges referencing a node id that isn't in the node set (defensive —
  // the shape is zod-validated but referential integrity across ids is not).
  const edges = (diagram?.edges ?? []).filter(
    (e) => centerOf.has(e.from) && centerOf.has(e.to) && e.from !== e.to,
  );

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height="auto"
      role="img"
      aria-label="Architecture diagram"
      style={{ display: "block", marginTop: 12 }}
    >
      <defs>
        <marker id="onboarding-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--text-muted)" />
        </marker>
      </defs>

      {edges.map((e, k) => {
        const a = centerOf.get(e.from)!;
        const b = centerOf.get(e.to)!;
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        return (
          <g key={k}>
            <path
              d={`M ${a.x} ${a.y} C ${mx} ${a.y}, ${mx} ${b.y}, ${b.x} ${b.y}`}
              fill="none"
              stroke="var(--border-strong)"
              strokeWidth={1.4}
              markerEnd="url(#onboarding-arrow)"
            />
            {e.label && (
              <text
                x={mx}
                y={my - 4}
                textAnchor="middle"
                fontSize={10.5}
                fill="var(--text-muted)"
              >
                {e.label}
              </text>
            )}
          </g>
        );
      })}

      {nodes.map((n) => {
        const c = centerOf.get(n.id)!;
        return (
          <g key={n.id}>
            <rect
              x={c.x - NODE_W / 2}
              y={c.y - NODE_H / 2}
              width={NODE_W}
              height={NODE_H}
              rx={8}
              fill="var(--bg-elevated)"
              stroke="var(--accent-text)"
              strokeWidth={1}
            />
            <text x={c.x} y={c.y + 4} textAnchor="middle" fontSize={12.5} fontWeight={600} fill="var(--text-primary)">
              {n.label}
            </text>
            {n.kind && (
              <text x={c.x} y={c.y + NODE_H / 2 - 3} textAnchor="middle" fontSize={9.5} fill="var(--text-muted)">
                {n.kind}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
