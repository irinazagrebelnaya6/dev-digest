#!/usr/bin/env node
// Dependency Checker — analyze-deps.mjs
//
// Zero-dependency Node script (built-ins only) that:
//   1. discovers every package.json in a repo (skipping node_modules/build/etc.)
//   2. computes the REAL on-disk footprint of each direct dependency
//      (dereferences pnpm/npm symlinks with `du -L`)
//   3. flags duplicate installed versions of the same package across manifests
//   4. flags "same version, different install" cases — identical version
//      string but physically separate copies (e.g. one pnpm-hardlinked, one
//      npm-installed) — a dual-package-hazard risk invisible to a version-only
//      diff, since nothing warns you until the copies actually drift apart
//   5. flags dependencies that are declared but never imported anywhere (heuristic)
//   6. optionally checks for outdated majors (--outdated; hits the npm registry)
//   7. renders a Mermaid diagram + a prioritized Markdown report
//
// Usage:
//   node scripts/analyze-deps.mjs [--root <dir>] [--top N] [--outdated] [--out <file>] [--exclude a,b,c]
//
// No npm install required — run directly with `node`.

import { promises as fs, existsSync, lstatSync, realpathSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const DEFAULT_EXCLUDES = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.turbo',
  '.cache', 'out', 'clones', '.pnpm-store', '.vercel',
]);
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

// KB thresholds. Tune here if a repo's scale warrants different tiers.
const TIERS = [
  { name: 'critical', min: 20 * 1024, emoji: '\u{1F534}' }, // >= 20 MB
  { name: 'large', min: 5 * 1024, emoji: '\u{1F7E0}' }, // >= 5 MB
  { name: 'medium', min: 1024, emoji: '\u{1F7E1}' }, // >= 1 MB
  { name: 'small', min: 0, emoji: '\u{1F7E2}' }, // < 1 MB
];

function tierFor(sizeKB) {
  return TIERS.find((t) => sizeKB >= t.min) ?? TIERS[TIERS.length - 1];
}

// Health score per package: starts at 100, deducted for the same findings
// that drive the prioritized action list (unused deps, duplicate versions,
// outdated majors). This scores cleanliness, not raw size — a large but
// unavoidable dependency (e.g. `next`, `typescript`) never costs points.
function computeScore(pkgName, unusedCount, duplicates, outdatedCount, hazards) {
  const dupCount = duplicates.filter((d) => d.versions.some((v) => v.packages.includes(pkgName))).length;
  const hazardCount = hazards.filter((h) => h.clusters.some((c) => c.some((e) => e.pkgName === pkgName))).length;
  const unusedPenalty = Math.min(60, unusedCount * 20);
  const dupPenalty = Math.min(30, dupCount * 10);
  const hazardPenalty = Math.min(30, hazardCount * 15); // same version, different physical copy — worse than a plain version mismatch
  const outdatedPenalty = Math.min(20, outdatedCount * 4);
  const score = Math.max(0, 100 - unusedPenalty - dupPenalty - hazardPenalty - outdatedPenalty);
  return { score, unusedCount, dupCount, hazardCount, outdatedCount };
}

function scoreLabel(score) {
  if (score >= 90) return 'Excellent';
  if (score >= 75) return 'Good';
  if (score >= 50) return 'Needs attention';
  return 'Poor';
}

function buildActions(manifestResults, duplicates, hazards) {
  const actions = [];
  for (const m of manifestResults) {
    for (const r of m.rows) {
      if (!r.isDev && !r.referenced) {
        actions.push({
          score: r.sizeKB ?? 0,
          text: `Remove \`${r.name}\` from **${m.name}** — declared but no import found (${fmtMB(r.sizeKB)}). Verify first, then \`pnpm remove\`.`,
          packages: [m.name],
        });
      }
    }
  }
  const sizeByDepName = new Map();
  for (const m of manifestResults) {
    for (const r of m.rows) {
      const known = sizeByDepName.get(r.name) ?? 0;
      sizeByDepName.set(r.name, Math.max(known, r.sizeKB ?? 0));
    }
  }
  for (const d of duplicates) {
    const score = sizeByDepName.get(d.name) ?? 0;
    actions.push({
      score,
      text: `Dedupe/pin \`${d.name}\` (${fmtMB(score)}) — resolves to ${d.versions.length} different versions across packages (${d.versions.map((v) => v.version).join(', ')}).`,
      packages: d.versions.flatMap((v) => v.packages),
    });
  }
  // Hazards outrank plain version-string duplicates: the versions already
  // match, so nothing will ever surface the drift until something breaks —
  // score them above their raw size to reflect that higher, silent risk.
  for (const h of hazards) {
    const score = (sizeByDepName.get(h.name) ?? 0) + 1024; // +1MB bias keeps these above equal-size dupes
    const clusterDesc = h.clusters.map(describeHazardCluster).join('; ');
    actions.push({
      score,
      text: `Unify the install of \`${h.name}@${h.version}\` — ${clusterDesc}. Same version today, but that's coincidence, not a guarantee: a future drift would silently break \`instanceof\`/identity checks with no version-mismatch warning to catch it.`,
      packages: h.clusters.flat().map((e) => e.pkgName),
    });
  }
  actions.sort((a, b) => b.score - a.score);
  return actions;
}

function parseArgs(argv) {
  const args = { root: process.cwd(), top: 15, outdated: false, out: null, exclude: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') args.root = path.resolve(argv[++i]);
    else if (a === '--top') args.top = Number(argv[++i]);
    else if (a === '--outdated') args.outdated = true;
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--exclude') args.exclude = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
  }
  return args;
}

async function discoverManifests(rootDir, excludeSet) {
  const results = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const hasManifest = entries.some((e) => e.isFile() && e.name === 'package.json');
    if (hasManifest) results.push(path.join(dir, 'package.json'));
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (excludeSet.has(e.name)) continue;
      if (e.name.startsWith('.') && e.name !== '.') continue; // skip hidden dirs generically (.next handled above, .vscode etc.)
      await walk(path.join(dir, e.name));
    }
  }
  await walk(rootDir);
  return results;
}

async function readManifest(manifestPath) {
  const dir = path.dirname(manifestPath);
  const raw = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  return {
    dir,
    name: raw.name ?? path.basename(dir),
    dependencies: raw.dependencies ?? {},
    devDependencies: raw.devDependencies ?? {},
  };
}

// Resolves a direct dependency's REAL on-disk footprint AND a physical
// identity signature. pnpm installs each top-level dep as a symlink into a
// *per-project* virtual store (`node_modules/.pnpm/<pkg>@<version>/...`), so
// `du` must dereference the symlink (-L) to size it correctly — but that
// resolved PATH is not a valid identity check: every project gets its own
// `.pnpm/<pkg>@<version>/` directory even when the files inside are
// hardlinked to the exact same blocks in pnpm's shared global store. Two
// hardlinked copies are the SAME physical file (device+inode match) despite
// living at different paths, while an npm-installed copy is a genuinely
// separate file even at an identical version string. So identity has to be
// device+inode of a representative file (package.json), not the path.
function resolveDepInfo(pkgDir, depName) {
  const depPath = path.join(pkgDir, 'node_modules', depName);
  if (!existsSync(depPath)) return { sizeKB: null, realPath: null, identity: null };
  let real = depPath;
  try {
    if (lstatSync(depPath).isSymbolicLink()) real = realpathSync(depPath);
  } catch {
    return { sizeKB: null, realPath: null, identity: null };
  }
  let sizeKB = null;
  try {
    const out = execFileSync('du', ['-skL', real], { encoding: 'utf8' });
    const kb = Number(out.split('\t')[0]);
    sizeKB = Number.isFinite(kb) ? kb : null;
  } catch {
    /* leave sizeKB null */
  }
  let identity = null;
  try {
    const st = statSync(path.join(real, 'package.json'));
    identity = `${st.dev}:${st.ino}`;
  } catch {
    /* leave identity null — falls back to treating it as unknown/unique below */
  }
  return { sizeKB, realPath: real, identity };
}

// Which package manager installed this package's node_modules — inferred
// from its lockfile. Two packages can resolve the same dependency to the
// exact same version string yet still hold genuinely separate physical
// copies if one is pnpm (hardlinked into a shared store) and the other is
// npm/yarn (always a standalone copy) — see findSameVersionDifferentInstall.
function detectPackageManager(pkgDir) {
  if (existsSync(path.join(pkgDir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(path.join(pkgDir, 'package-lock.json'))) return 'npm';
  if (existsSync(path.join(pkgDir, 'yarn.lock'))) return 'yarn';
  return 'unknown';
}

function getInstalledVersion(pkgDir, depName) {
  const manifestPath = path.join(pkgDir, 'node_modules', depName, 'package.json');
  if (!existsSync(manifestPath)) return null;
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf8')).version ?? null;
  } catch {
    return null;
  }
}

async function collectSourceText(pkgDir) {
  const chunks = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (DEFAULT_EXCLUDES.has(e.name)) continue;
        if (e.name.startsWith('.')) continue;
        await walk(full);
      } else if (SOURCE_EXTENSIONS.has(path.extname(e.name))) {
        try {
          chunks.push(await fs.readFile(full, 'utf8'));
        } catch {
          /* unreadable file, skip */
        }
      }
    }
  }
  await walk(pkgDir);
  return chunks.join('\n');
}

function isDepReferenced(depName, sourceText) {
  // Matches `from '<dep>'`, `from '<dep>/sub'`, require('<dep>'), import('<dep>').
  // Heuristic only — see references/metrics.md for what this misses.
  const escaped = depName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(['"\`])${escaped}(?:/[^'"\`]*)?\\1`);
  return re.test(sourceText);
}

function checkOutdated(pkgDir) {
  try {
    const out = execFileSync('npm', ['outdated', '--json'], {
      cwd: pkgDir,
      encoding: 'utf8',
      timeout: 60_000,
    });
    return JSON.parse(out || '{}');
  } catch (err) {
    // `npm outdated` exits non-zero when it FOUND outdated packages — that's
    // not a failure, the JSON is still on stdout.
    if (err.stdout) {
      try {
        return JSON.parse(err.stdout);
      } catch {
        return null;
      }
    }
    return null; // offline, npm missing, or timed out — degrade silently
  }
}

function sanitizeMermaidId(name) {
  return 'n_' + name.replace(/[^a-zA-Z0-9]/g, '_');
}

function fmtMB(kb) {
  if (kb == null) return 'n/a';
  return (kb / 1024).toFixed(1) + ' MB';
}

function buildRepoDiagram(packageSummaries) {
  const lines = ['```mermaid', 'flowchart TD'];
  for (const p of packageSummaries) {
    const id = sanitizeMermaidId(p.name);
    const tier = tierFor(p.totalKB);
    lines.push(`  ${id}["${p.name}\\n${fmtMB(p.totalKB)}"]:::${tier.name}`);
  }
  lines.push(
    '  classDef critical fill:#f8d7da,stroke:#b02a37,color:#58151c',
    '  classDef large fill:#ffe5c2,stroke:#b3620a,color:#5c3103',
    '  classDef medium fill:#fff3b0,stroke:#8a6d00,color:#4d3c00',
    '  classDef small fill:#d4edda,stroke:#2e7d32,color:#173d1c',
  );
  lines.push('```');
  return lines.join('\n');
}

function buildPackageDiagram(pkgName, topDeps) {
  const id = (n) => sanitizeMermaidId(pkgName + '_' + n);
  const lines = ['```mermaid', 'flowchart LR', `  root["${pkgName}"]`];
  for (const d of topDeps) {
    const tier = tierFor(d.sizeKB ?? 0);
    lines.push(`  root --> ${id(d.name)}["${d.name}\\n${fmtMB(d.sizeKB)}"]:::${tier.name}`);
  }
  lines.push(
    '  classDef critical fill:#f8d7da,stroke:#b02a37,color:#58151c',
    '  classDef large fill:#ffe5c2,stroke:#b3620a,color:#5c3103',
    '  classDef medium fill:#fff3b0,stroke:#8a6d00,color:#4d3c00',
    '  classDef small fill:#d4edda,stroke:#2e7d32,color:#173d1c',
  );
  lines.push('```');
  return lines.join('\n');
}

async function analyzeManifest(manifest, { top, checkOutdatedFlag }) {
  const depNames = Object.keys(manifest.dependencies);
  const devDepNames = Object.keys(manifest.devDependencies);
  const sourceText = await collectSourceText(manifest.dir);

  const rows = [...depNames, ...devDepNames].map((name) => {
    const { sizeKB, realPath, identity } = resolveDepInfo(manifest.dir, name);
    const version = getInstalledVersion(manifest.dir, name);
    const isDev = devDepNames.includes(name);
    const referenced = isDev ? true : isDepReferenced(name, sourceText); // don't flag devDeps as unused
    return { name, version, sizeKB, realPath, identity, isDev, referenced };
  });

  rows.sort((a, b) => (b.sizeKB ?? -1) - (a.sizeKB ?? -1));
  const totalKB = rows.reduce((sum, r) => sum + (r.sizeKB ?? 0), 0);
  const unused = rows.filter((r) => !r.isDev && !r.referenced);

  let outdated = null;
  if (checkOutdatedFlag) outdated = checkOutdated(manifest.dir);

  return { name: manifest.name, dir: manifest.dir, rows, totalKB, unused, outdated, top };
}

function findDuplicateVersions(manifestResults) {
  const seen = new Map(); // depName -> Set of "version@packageName"
  for (const m of manifestResults) {
    for (const r of m.rows) {
      if (!r.version) continue;
      if (!seen.has(r.name)) seen.set(r.name, new Map());
      const versions = seen.get(r.name);
      if (!versions.has(r.version)) versions.set(r.version, []);
      versions.get(r.version).push(m.name);
    }
  }
  const duplicates = [];
  for (const [depName, versions] of seen) {
    if (versions.size > 1) {
      duplicates.push({
        name: depName,
        versions: [...versions.entries()].map(([v, pkgs]) => ({ version: v, packages: pkgs })),
      });
    }
  }
  return duplicates;
}

// The version-string check above (findDuplicateVersions) is blind to a more
// dangerous case: two packages can resolve a dependency to the exact same
// version yet hold genuinely separate physical copies (e.g. one installed
// via pnpm's hardlinked store, the other via plain npm). Same version number,
// different module instance in memory — `instanceof`/identity checks (Zod's
// `instanceof ZodError`, custom error classes, etc.) can silently break the
// moment the two copies drift, and nothing about a version-string match would
// have warned you. This compares real, dereferenced install paths instead of
// version strings to catch that case directly.
function findSameVersionDifferentInstall(manifestResults) {
  const groups = new Map(); // "name\0version" -> [{ pkgName, identity, pkgManager }]
  for (const m of manifestResults) {
    const pkgManager = detectPackageManager(m.dir);
    for (const r of m.rows) {
      if (!r.version || !r.identity) continue;
      const key = `${r.name}\0${r.version}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ pkgName: m.name, identity: r.identity, pkgManager });
    }
  }
  const hazards = [];
  for (const [key, entries] of groups) {
    if (entries.length < 2) continue;
    const byIdentity = new Map();
    for (const e of entries) {
      if (!byIdentity.has(e.identity)) byIdentity.set(e.identity, []);
      byIdentity.get(e.identity).push(e);
    }
    if (byIdentity.size <= 1) continue; // same device+inode everywhere (e.g. pnpm hardlinks) — fully deduped, no hazard
    // Sort largest cluster first: usually the shared/hardlinked copy, with
    // the smaller cluster(s) being the genuinely separate outlier(s).
    const clusters = [...byIdentity.values()].sort((a, b) => b.length - a.length);
    const [name, version] = key.split('\0');
    hazards.push({ name, version, clusters });
  }
  return hazards;
}

function describeHazardCluster(cluster) {
  const names = cluster.map((e) => e.pkgName).join(' + ');
  const manager = cluster[0].pkgManager;
  return cluster.length > 1
    ? `${names} share one ${manager}-managed copy`
    : `${names} holds its own separate ${manager}-installed copy`;
}

function buildMarkdown({ manifestResults, duplicates, hazards, args }) {
  const lines = [];
  const totalKBAll = manifestResults.reduce((s, m) => s + m.totalKB, 0);
  const packageSummaries = manifestResults.map((m) => ({ name: m.name, totalKB: m.totalKB }));

  lines.push('# Dependency Report');
  lines.push('');
  lines.push(
    `**${manifestResults.length} package(s) analyzed** · **${fmtMB(totalKBAll)}** total direct-dependency footprint on disk.`,
  );
  lines.push('');
  const actions = buildActions(manifestResults, duplicates, hazards);
  const scores = new Map(
    manifestResults.map((m) => [
      m.name,
      computeScore(m.name, m.unused.length, duplicates, m.outdated ? Object.keys(m.outdated).length : 0, hazards),
    ]),
  );

  lines.push('## Executive summary');
  lines.push('');
  lines.push('| Package | Score | Size | Findings | Top priority |');
  lines.push('|---|---|---|---|---|');
  for (const m of manifestResults) {
    const s = scores.get(m.name);
    const findingsCount = s.unusedCount + s.dupCount + s.hazardCount;
    const topAction = actions.find((a) => a.packages.includes(m.name));
    lines.push(
      `| ${m.name} | ${s.score}/100 (${scoreLabel(s.score)}) | ${fmtMB(m.totalKB)} | ${findingsCount} | ${topAction ? topAction.text : 'No action needed'} |`,
    );
  }
  lines.push('');
  lines.push('```mermaid');
  lines.push('xychart-beta');
  lines.push('  title "Dependency health score by package"');
  lines.push(`  x-axis [${manifestResults.map((m) => JSON.stringify(m.name)).join(', ')}]`);
  lines.push('  y-axis "Score" 0 --> 100');
  lines.push(`  bar [${manifestResults.map((m) => scores.get(m.name).score).join(', ')}]`);
  lines.push('```');
  lines.push('');

  lines.push('## Repo overview');
  lines.push('');
  lines.push(buildRepoDiagram(packageSummaries));
  lines.push('');

  for (const m of manifestResults) {
    const s = scores.get(m.name);
    lines.push(`## ${m.name} (\`${path.relative(args.root, m.dir) || '.'}\`) — Score: ${s.score}/100 (${scoreLabel(s.score)})`);
    lines.push('');
    if (!existsSync(path.join(m.dir, 'node_modules'))) {
      lines.push(`⚠️ \`node_modules\` not found for this package — run \`pnpm install\` (or npm/yarn) here first. Sizes below are unavailable until then.`);
      lines.push('');
    }
    lines.push(`Total direct-dependency footprint: **${fmtMB(m.totalKB)}**`);
    lines.push('');
    const topRows = m.rows.slice(0, args.top);
    lines.push(buildPackageDiagram(m.name, topRows));
    lines.push('');
    lines.push(`| # | Package | Version | Size | Tier | Type | Notes |`);
    lines.push(`|---|---|---|---|---|---|---|`);
    topRows.forEach((r, i) => {
      const tier = tierFor(r.sizeKB ?? 0);
      const notes = [];
      if (!r.isDev && !r.referenced) notes.push('possibly unused');
      lines.push(
        `| ${i + 1} | ${r.name} | ${r.version ?? 'n/a'} | ${fmtMB(r.sizeKB)} | ${tier.emoji} ${tier.name} | ${r.isDev ? 'dev' : 'prod'} | ${notes.join(', ') || '-'} |`,
      );
    });
    lines.push('');
    if (m.unused.length) {
      lines.push(`**Possibly unused (${m.unused.length}):** no import/require found for: ${m.unused.map((r) => `\`${r.name}\``).join(', ')}. Heuristic — verify before removing (see references/metrics.md).`);
      lines.push('');
    }
    if (m.outdated && Object.keys(m.outdated).length) {
      lines.push('**Outdated:**');
      lines.push('');
      lines.push('| Package | Current | Wanted | Latest |');
      lines.push('|---|---|---|---|');
      for (const [name, info] of Object.entries(m.outdated)) {
        lines.push(`| ${name} | ${info.current ?? '?'} | ${info.wanted ?? '?'} | ${info.latest ?? '?'} |`);
      }
      lines.push('');
    }
  }

  if (duplicates.length) {
    lines.push('## Duplicate versions across packages');
    lines.push('');
    lines.push('Same package resolved to different installed versions in different manifests — candidates for pinning/deduping.');
    lines.push('');
    lines.push('| Package | Versions found |');
    lines.push('|---|---|');
    for (const d of duplicates) {
      const versionStr = d.versions.map((v) => `${v.version} (${v.packages.join(', ')})`).join('; ');
      lines.push(`| ${d.name} | ${versionStr} |`);
    }
    lines.push('');
  }

  if (hazards.length) {
    lines.push('## Same version, different install (dual-package-hazard risk)');
    lines.push('');
    lines.push(
      "These resolve to the **exact same version string** in every package that has them, so the duplicate-version check above sees no problem — but they're physically separate installs (different package manager / store), not one shared copy. Nothing keeps them in sync: if one package updates independently, `instanceof`/identity checks (e.g. `err instanceof SomeError` across a Zod/custom-error boundary) can start silently failing with no version-mismatch warning to catch it, because the versions matched right up until they didn't.",
    );
    lines.push('');
    lines.push('| Package | Version | Who shares a copy, who doesn\'t |');
    lines.push('|---|---|---|');
    for (const h of hazards) {
      const clusterDesc = h.clusters.map(describeHazardCluster).join('; ');
      lines.push(`| ${h.name} | ${h.version} | ${clusterDesc} |`);
    }
    lines.push('');
  }

  lines.push('## Prioritized action list');
  lines.push('');
  if (actions.length) {
    actions.forEach((a, i) => lines.push(`${i + 1}. ${a.text}`));
  } else {
    lines.push('No unused or duplicate-version findings — nothing actionable beyond the size table above.');
  }
  lines.push('');

  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const excludeSet = new Set([...DEFAULT_EXCLUDES, ...args.exclude]);

  const manifestPaths = await discoverManifests(args.root, excludeSet);
  const manifests = await Promise.all(manifestPaths.map(readManifest));
  const manifestResults = await Promise.all(
    manifests.map((m) => analyzeManifest(m, { top: args.top, checkOutdatedFlag: args.outdated })),
  );
  const duplicates = findDuplicateVersions(manifestResults);
  const hazards = findSameVersionDifferentInstall(manifestResults);

  const markdown = buildMarkdown({ manifestResults, duplicates, hazards, args });

  if (args.out) {
    await fs.writeFile(args.out, markdown, 'utf8');
    console.log(`Report written to ${args.out}`);
  } else {
    console.log(markdown);
  }
}

main().catch((err) => {
  console.error('analyze-deps failed:', err.message);
  process.exit(1);
});
