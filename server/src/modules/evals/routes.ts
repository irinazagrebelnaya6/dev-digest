import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { EvalCaseInput, EvalExpectation } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import type { Container } from '../../platform/container.js';
import { EvalsService } from './service.js';
import { EVAL_RUN_RATE_LIMIT } from './constants.js';

/**
 * SPEC-05 — evals module.
 *   POST   /findings/:id/eval-case          → "Turn into eval case" (AC-2, AC-3)
 *   GET    /agents/:id/eval-cases           → list an agent's cases (AC-1)
 *   POST   /agents/:id/eval-cases           → create a case (owner derived from URL, Q8)
 *   GET    /eval-cases/:id                  → one case
 *   PUT    /eval-cases/:id                  → update a case (AC-20)
 *   DELETE /eval-cases/:id                  → delete a case
 *   POST   /agents/:id/eval-runs            → run all of an agent's cases (AC-6), rate-limited
 *   POST   /eval-cases/:id/eval-runs        → run one case (AC-20's "Run case"), rate-limited
 *   POST   /eval-dashboard/run-all          → run all enabled agents with cases (AC-16), rate-limited
 *   GET    /agents/:id/eval-dashboard       → per-agent dashboard aggregate (AC-15, AC-18)
 *   GET    /eval-dashboard                  → workspace-wide dashboard aggregate (AC-15, AC-17)
 *   GET    /agents/:id/eval-runs            → an agent's run history, batches (AC-19)
 *   GET    /eval-runs/compare               → metric deltas + system-prompt diff (AC-12, AC-13)
 *   POST   /eval-runs/:batch_id/promote     → apply a batch's tagged version as the agent's live config (AC-14)
 *
 * Every handler resolves `getContext()` first (AC-21); cross-workspace ids
 * resolve to `NotFoundError` either here (agent existence checks) or inside
 * `EvalsService`/`EvalsRepository` (workspace-scoped queries/joins).
 */

// Recommendation 3: `EvalCaseInput` stays `z.unknown()` for `expected_output`
// at the shared-contract level; narrow it LOCALLY here so AC-20's "invalid
// expected-output JSON is rejected before save" holds without touching the
// contract other consumers rely on. `owner_kind`/`owner_id` are omitted — the
// route derives them from the URL (Q8), never trusting the body.
const CreateEvalCaseBody = EvalCaseInput.omit({ owner_kind: true, owner_id: true }).extend({
  expected_output: EvalExpectation,
});

const UpdateEvalCaseBody = z.object({
  name: z.string().min(1).optional(),
  input_diff: z.string().optional(),
  input_files: z.unknown().optional(),
  input_meta: z.unknown().optional(),
  expected_output: EvalExpectation.optional(),
  notes: z.string().nullish(),
});

const CompareQuery = z.object({
  a: z.string().min(1),
  b: z.string().min(1),
});

const BatchParams = z.object({
  batch_id: z.string().min(1),
});

async function requireAgent(container: Container, workspaceId: string, agentId: string) {
  const agent = await container.agentsRepo.getById(workspaceId, agentId);
  if (!agent) throw new NotFoundError('Agent not found');
}

export default async function evalsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new EvalsService(container);

  // ---- "Turn into eval case" (AC-2, AC-3) ----------------------------------
  app.post('/findings/:id/eval-case', { schema: { params: IdParams } }, async (req, reply) => {
    const { workspaceId } = await getContext(container, req);
    const evalCase = await service.createCaseFromFinding(workspaceId, req.params.id);
    reply.status(201);
    return evalCase;
  });

  // ---- Case CRUD (AC-1, AC-19, AC-20, AC-21) -------------------------------
  app.get('/agents/:id/eval-cases', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    await requireAgent(container, workspaceId, req.params.id);
    return service.listCasesForOwner(workspaceId, 'agent', req.params.id);
  });

  app.post(
    '/agents/:id/eval-cases',
    { schema: { params: IdParams, body: CreateEvalCaseBody } },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      await requireAgent(container, workspaceId, req.params.id);
      const body = req.body;
      const evalCase = await service.createCase(workspaceId, {
        owner_kind: 'agent',
        owner_id: req.params.id,
        name: body.name,
        input_diff: body.input_diff,
        input_files: body.input_files,
        input_meta: body.input_meta,
        expected_output: body.expected_output,
        notes: body.notes,
      });
      reply.status(201);
      return evalCase;
    },
  );

  app.get('/eval-cases/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const evalCase = await service.getCase(workspaceId, req.params.id);
    if (!evalCase) throw new NotFoundError('Eval case not found');
    return evalCase;
  });

  app.put(
    '/eval-cases/:id',
    { schema: { params: IdParams, body: UpdateEvalCaseBody } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      const evalCase = await service.updateCase(workspaceId, req.params.id, req.body);
      if (!evalCase) throw new NotFoundError('Eval case not found');
      return evalCase;
    },
  );

  app.delete('/eval-cases/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const ok = await service.deleteCase(workspaceId, req.params.id);
    if (!ok) throw new NotFoundError('Eval case not found');
    return { ok: true };
  });

  // ---- Batch-triggering routes (AC-6, AC-16, AC-20's "Run case") -----------
  // Rate-limited tighter than /pulls/:id/review (Q6): a batch fans out to N
  // LLM calls per click, not one.
  app.post(
    '/agents/:id/eval-runs',
    { schema: { params: IdParams }, config: { rateLimit: EVAL_RUN_RATE_LIMIT } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.runForAgent(workspaceId, req.params.id);
    },
  );

  app.post(
    '/eval-cases/:id/eval-runs',
    { schema: { params: IdParams }, config: { rateLimit: EVAL_RUN_RATE_LIMIT } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.runForCase(workspaceId, req.params.id);
    },
  );

  app.post(
    '/eval-dashboard/run-all',
    { config: { rateLimit: EVAL_RUN_RATE_LIMIT } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.runAllAgents(workspaceId);
    },
  );

  // ---- Dashboard reads (AC-15, AC-17, AC-18, AC-19) ------------------------
  app.get('/agents/:id/eval-dashboard', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.perAgentDashboard(workspaceId, req.params.id);
  });

  app.get('/eval-dashboard', async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.workspaceDashboard(workspaceId);
  });

  app.get('/agents/:id/eval-runs', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.runHistoryForAgent(workspaceId, req.params.id);
  });

  // ---- Compare + Promote (AC-12, AC-13, AC-14) -----------------------------
  app.get('/eval-runs/compare', { schema: { querystring: CompareQuery } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.compareBatches(workspaceId, req.query.a, req.query.b);
  });

  app.post(
    '/eval-runs/:batch_id/promote',
    { schema: { params: BatchParams } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.promoteBatch(workspaceId, req.params.batch_id);
    },
  );
}
