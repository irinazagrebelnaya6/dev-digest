import { describe, it, expect } from 'vitest';
import { handleGetBlastRadius } from '../../src/mcp/tools/get-blast-radius.js';
import type { Container } from '../../src/platform/container.js';

// The stub never touches the container — a bare cast is fine (DB-free unit test).
const noContainer = {} as Container;

describe('get_blast_radius (stub)', () => {
  it('returns the exact stable not_implemented shape with isError false', async () => {
    const res = await handleGetBlastRadius(noContainer, { repo: 'acme/payments-api', pr: 482 });
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toEqual({
      status: 'not_implemented',
      pr: { repo: 'acme/payments-api', number: 482 },
      impacted_files: [],
      impacted_symbols: [],
      risk_score: null,
      message: 'Blast radius analysis is not yet implemented.',
    });
    expect(res.content[0]).toMatchObject({ type: 'text' });
  });
});
