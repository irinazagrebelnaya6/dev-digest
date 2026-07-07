/**
 * devdigest CLI — pre-push local review.
 *
 *   devdigest review --mode working [--agent <id>] [--json]
 *
 * Gets the working-copy diff (`git diff`) and reviews it with the SAME
 * Structured Reviewer engine + agents the PR review uses — via
 * `ReviewService.reviewDiff` → `reviewPullRequest` (@devdigest/reviewer-core).
 * Prints the structured findings to the terminal. Nothing is pushed and nothing
 * is persisted: this runs entirely against the developer's working tree, before
 * `git push` / a PR exists.
 *
 * Exit codes: 0 = reviewed, no blockers · 1 = blocking finding(s) (so it can
 * gate a pre-push hook) · 2 = usage / environment error.
 *
 * The `--mode` flag leaves room for future modes; only `working` is implemented:
 *   working → `git diff HEAD`      (everything in the working copy, not committed)
 *   staged  → `git diff --cached`  (future)
 *   branch  → `git diff <base>...HEAD` (future)
 */
import { execFileSync } from 'node:child_process';
import { parseUnifiedDiff } from '../adapters/git/diff-parser.js';
import { buildMcpContainer } from './bootstrap.js';
import { currentWorkspace } from './context.js';
import { ReviewService, type LocalAgentReview } from '../modules/reviews/service.js';
import { AppError } from '../platform/errors.js';

export type ReviewMode = 'working' | 'staged' | 'branch';

export interface CliArgs {
  command: string;
  mode: ReviewMode;
  agent?: string;
  json: boolean;
  help: boolean;
  /** Unknown/unsupported token, surfaced as a usage error. */
  error?: string;
}

const MODES: ReviewMode[] = ['working', 'staged', 'branch'];

/**
 * Pure arg parser (exported for tests). Accepts an optional leading `review`
 * command token so both `devdigest review --mode working` and a bare
 * `--mode working` (npm-script invocation) work. Defaults: mode=working, json=false.
 */
export function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { command: 'review', mode: 'working', json: false, help: false };
  let i = 0;
  if (argv[i] && !argv[i]!.startsWith('-')) {
    out.command = argv[i]!;
    i++;
  }
  for (; i < argv.length; i++) {
    const a = argv[i]!;
    switch (a) {
      case '-h':
      case '--help':
        out.help = true;
        break;
      case '--json':
        out.json = true;
        break;
      case '--mode': {
        const v = argv[++i];
        if (!v || !MODES.includes(v as ReviewMode)) {
          out.error = `--mode must be one of: ${MODES.join(', ')}`;
        } else {
          out.mode = v as ReviewMode;
        }
        break;
      }
      case '--agent': {
        const v = argv[++i];
        if (!v) out.error = '--agent requires an agent id';
        else out.agent = v;
        break;
      }
      default:
        if (a.startsWith('--mode=')) {
          const v = a.slice('--mode='.length);
          if (!MODES.includes(v as ReviewMode)) out.error = `--mode must be one of: ${MODES.join(', ')}`;
          else out.mode = v as ReviewMode;
        } else if (a.startsWith('--agent=')) {
          out.agent = a.slice('--agent='.length);
        } else {
          out.error = `Unknown argument: ${a}`;
        }
    }
  }
  return out;
}

const HELP = `devdigest — local pre-push review

Usage:
  devdigest review --mode working [--agent <id>] [--json]

Reviews the current working-copy diff (git diff HEAD) with the same reviewer
agents used on the PR page, and prints the findings. No push required.

Options:
  --mode <working>   What to review (only "working" is implemented; staged/branch reserved)
  --agent <id>       Run a single agent (default: all enabled agents)
  --json             Emit machine-readable JSON instead of formatted text
  -h, --help         Show this help

Exit codes: 0 = no blocking findings · 1 = blocking finding(s) · 2 = usage/error`;

// ---- terminal formatting --------------------------------------------------

const isTty = Boolean(process.stdout.isTTY);
const paint = (code: string, s: string) => (isTty ? `\x1b[${code}m${s}\x1b[0m` : s);
const c = {
  bold: (s: string) => paint('1', s),
  dim: (s: string) => paint('2', s),
  red: (s: string) => paint('31', s),
  yellow: (s: string) => paint('33', s),
  blue: (s: string) => paint('34', s),
  green: (s: string) => paint('32', s),
};

const SEVERITY_RANK: Record<string, number> = { CRITICAL: 0, WARNING: 1, SUGGESTION: 2 };
function severityLabel(sev: string): string {
  if (sev === 'CRITICAL') return c.red('✖ CRITICAL  ');
  if (sev === 'WARNING') return c.yellow('▲ WARNING   ');
  if (sev === 'SUGGESTION') return c.blue('• SUGGESTION');
  return sev;
}

/** Render all agents' results as human-readable text (returns the string). */
export function formatResults(results: LocalAgentReview[]): string {
  const lines: string[] = [];
  for (const r of results) {
    lines.push('');
    lines.push(`${c.bold('▌ ' + r.agent.name)}  ${c.dim(`(${r.agent.provider}/${r.agent.model})`)}`);
    if (r.error || !r.review) {
      lines.push(`  ${c.red('failed:')} ${r.error ?? 'no review produced'}`);
      continue;
    }
    const { verdict, score, findings } = r.review;
    lines.push(
      `  ${c.dim('verdict:')} ${verdict} · ${c.dim('score')} ${score} · ${c.dim('grounding')} ${r.grounding}` +
        (r.costUsd != null ? ` · ${c.dim('~$' + r.costUsd.toFixed(4))}` : ''),
    );
    if (findings.length === 0) {
      lines.push(`  ${c.green('no findings')}`);
      continue;
    }
    const sorted = [...findings].sort(
      (a, b) => (SEVERITY_RANK[a.severity] ?? 99) - (SEVERITY_RANK[b.severity] ?? 99),
    );
    for (const f of sorted) {
      lines.push('');
      lines.push(`  ${severityLabel(f.severity)} ${c.bold(`${f.file}:${f.start_line}`)}  ${c.dim(`[${f.category}]`)}`);
      lines.push(`     ${f.title}`);
      if (f.rationale) lines.push(`     ${c.dim(oneLine(f.rationale))}`);
      if (f.suggestion) lines.push(`     ${c.green('→ ' + oneLine(f.suggestion))}`);
    }
  }
  return lines.join('\n');
}

/** Collapse markdown/multiline rationale to a single trimmed line for the terminal. */
function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

// ---- git ------------------------------------------------------------------

/** The `git diff` command for a mode. Only `working` is wired today. */
export function gitDiffArgs(mode: ReviewMode): string[] | null {
  switch (mode) {
    case 'working':
      return ['diff', 'HEAD'];
    default:
      return null; // staged / branch reserved for future modes
  }
}

function readWorkingDiff(mode: ReviewMode): string {
  const args = gitDiffArgs(mode);
  if (!args) {
    throw new AppError('unsupported_mode', `--mode ${mode} is not implemented yet (only "working").`, 400);
  }
  try {
    return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    const msg = (err as { stderr?: Buffer }).stderr?.toString().trim() || (err as Error).message;
    throw new AppError('git_failed', `git ${args.join(' ')} failed: ${msg}`, 2);
  }
}

// ---- main -----------------------------------------------------------------

export async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);

  if (args.help) {
    console.log(HELP);
    return 0;
  }
  if (args.command !== 'review') {
    console.error(`Unknown command "${args.command}". Try: devdigest review --mode working`);
    return 2;
  }
  if (args.error) {
    console.error(args.error + '\n\n' + HELP);
    return 2;
  }

  // 1) Local working-copy diff.
  const raw = readWorkingDiff(args.mode);
  const diff = parseUnifiedDiff(raw);
  if (diff.files.length === 0) {
    console.log(c.green('✓ Working tree clean — nothing to review.'));
    return 0;
  }
  const added = diff.files.reduce((n, f) => n + f.additions, 0);
  const removed = diff.files.reduce((n, f) => n + f.deletions, 0);
  // Keep stdout pure JSON in --json mode; the banner goes to stderr instead.
  const banner =
    c.bold('DevDigest — local review (working tree)') +
    `\n${diff.files.length} changed file(s), ${c.green('+' + added)} / ${c.red('-' + removed)} lines`;
  if (args.json) process.stderr.write(banner + '\n');
  else console.log(banner);

  // 2) Same engine + agents as the PR review — via the application layer.
  const { container, close } = await buildMcpContainer();
  try {
    const ws = await currentWorkspace(container);
    const service = new ReviewService(container);
    const results = await service.reviewDiff(ws.id, diff, {
      ...(args.agent ? { agentId: args.agent } : { all: true }),
      onEvent: args.json ? undefined : (e) => process.stderr.write(c.dim(`  … ${e.msg}\n`)),
    });

    // 3) Output.
    if (args.json) {
      console.log(JSON.stringify({ mode: args.mode, files: diff.files.length, results }, null, 2));
    } else {
      console.log(formatResults(results));
    }

    const totalBlockers = results.reduce((n, r) => n + r.blockers, 0);
    const totalFindings = results.reduce((n, r) => n + (r.review?.findings.length ?? 0), 0);
    if (!args.json) {
      console.log(
        '\n' +
          (totalBlockers > 0
            ? c.red(`✖ ${totalBlockers} blocking finding(s) — review before pushing.`)
            : c.green(`✓ ${totalFindings} finding(s), none blocking.`)),
      );
    }
    return totalBlockers > 0 ? 1 : 0;
  } catch (err) {
    if (err instanceof AppError) {
      console.error(c.red(err.message));
      return 2;
    }
    throw err;
  } finally {
    await close();
  }
}

// Executed directly (via the bin launcher / tsx). Guarded so imports (tests)
// don't trigger a run.
const invokedDirectly =
  typeof process.argv[1] === 'string' && /mcp[/\\]cli\.ts$/.test(process.argv[1]);
if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(err instanceof Error ? err.stack ?? err.message : String(err));
      process.exit(2);
    });
}
