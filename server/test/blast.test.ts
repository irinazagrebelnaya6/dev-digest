import { describe, it, expect } from 'vitest';
import { composeBlastRadius, MAX_CALLERS_PER_SYMBOL } from '../src/modules/blast/blast.js';
import type { BlastResult } from '../src/modules/repo-intel/types.js';

/**
 * Pure composer coverage. No provider/DB import here — its absence is itself
 * proof that composing the blast map makes NO LLM call.
 */
describe('composeBlastRadius', () => {
  const result: BlastResult = {
    changedSymbols: [
      { file: 'src/lib/money.ts', name: 'formatCents', kind: 'function' },
      { file: 'src/lib/money.ts', name: 'parseCents', kind: 'function' },
    ],
    callers: [
      { file: 'src/api/invoices.ts', symbol: 'listInvoices', viaSymbol: 'formatCents', line: 42, rank: 0.9 },
      { file: 'src/api/orders.ts', symbol: 'getOrder', viaSymbol: 'formatCents', line: 17, rank: 0.5 },
      { file: 'src/workers/report.ts', symbol: 'buildReport', viaSymbol: 'parseCents', line: 88, rank: 0.3 },
    ],
    impactedEndpoints: ['GET /invoices', 'GET /orders/:id'],
    factsByFile: {
      'src/api/invoices.ts': { endpoints: ['GET /invoices'], crons: [] },
      'src/api/orders.ts': { endpoints: ['GET /orders/:id'], crons: [] },
      'src/workers/report.ts': { endpoints: [], crons: ['0 0 * * *'] },
    },
    degraded: false,
  };

  it('maps changed symbols 1:1', () => {
    const b = composeBlastRadius(result, [], '');
    expect(b.changed_symbols).toEqual([
      { name: 'formatCents', file: 'src/lib/money.ts', kind: 'function' },
      { name: 'parseCents', file: 'src/lib/money.ts', kind: 'function' },
    ]);
  });

  it('groups callers under the changed symbol they reach, with per-symbol endpoints', () => {
    const b = composeBlastRadius(result, [], '');
    const fmt = b.downstream.find((d) => d.symbol === 'formatCents');
    expect(fmt?.callers).toEqual([
      { name: 'listInvoices', file: 'src/api/invoices.ts', line: 42 },
      { name: 'getOrder', file: 'src/api/orders.ts', line: 17 },
    ]);
    expect(fmt?.endpoints_affected).toEqual(['GET /invoices', 'GET /orders/:id']);

    const parse = b.downstream.find((d) => d.symbol === 'parseCents');
    expect(parse?.callers).toHaveLength(1);
    expect(parse?.endpoints_affected).toEqual([]);
    expect(parse?.crons_affected).toEqual(['0 0 * * *']);
  });

  it('caps callers per symbol at MAX_CALLERS_PER_SYMBOL', () => {
    const many: BlastResult = {
      changedSymbols: [{ file: 'a.ts', name: 'helper', kind: 'function' }],
      callers: Array.from({ length: MAX_CALLERS_PER_SYMBOL + 5 }, (_, i) => ({
        file: `c${i}.ts`,
        symbol: `s${i}`,
        viaSymbol: 'helper',
        line: i + 1,
        rank: 0,
      })),
      impactedEndpoints: [],
      degraded: false,
    };
    const b = composeBlastRadius(many, [], '');
    expect(b.downstream[0]?.callers).toHaveLength(MAX_CALLERS_PER_SYMBOL);
  });

  it('dedupes + sorts reachable_endpoints and carries degraded/reason/summary', () => {
    const b = composeBlastRadius(
      { changedSymbols: [], callers: [], impactedEndpoints: [], degraded: true, reason: 'no_data' },
      ['POST /x', 'GET /a', 'POST /x'],
      'a one-line summary',
    );
    expect(b.reachable_endpoints).toEqual(['GET /a', 'POST /x']);
    expect(b.downstream).toEqual([]);
    expect(b.degraded).toBe(true);
    expect(b.reason).toBe('no_data');
    expect(b.summary).toBe('a one-line summary');
  });
});
