import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import { UpdateConventionBody } from '@devdigest/shared';
import { ConventionsService } from './service.js';
import { SkillsService } from '../skills/service.js';
import { extractConventions } from './extractor.js';
import { renderSkillBody } from './helpers.js';
import * as t from '../../db/schema.js';

/**
 * Conventions Extractor module.
 *
 *   POST /repos/:id/conventions/extract  → run extraction pipeline
 *   GET  /repos/:id/conventions          → list all candidates
 *   PATCH /conventions/:id               → accept / reject a candidate
 */
export default async function conventionsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new ConventionsService(container);
  const skillsService = new SkillsService(container);

  // ---- POST /repos/:id/conventions/extract ------------------------------ //
  app.post(
    '/repos/:id/conventions/extract',
    {
      schema: {
        params: IdParams,
        body: z.object({ force: z.boolean().optional() }),
      },
    },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const repoId = req.params.id;

      // Resolve repo row for owner/name/branch (needed to read files via git)
      const [repo] = await container.db
        .select()
        .from(t.repos)
        .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));

      if (!repo) throw new NotFoundError('Repo not found');

      // If force=true, clear all previous candidates for this repo
      if (req.body.force) {
        const existing = await container.conventionsRepo.listByRepo(workspaceId, repoId);
        const runIds = [...new Set(existing.map((r) => r.extractionRunId).filter(Boolean) as string[])];
        for (const runId of runIds) {
          await service.deleteByRunId(workspaceId, runId);
        }
      }

      // Run extraction pipeline (config files + LLM + grounding)
      let result;
      try {
        result = await extractConventions(container, workspaceId, repoId, {
          owner: repo.owner,
          name: repo.name,
          defaultBranch: repo.defaultBranch,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new ValidationError(`Extraction failed: ${msg}`);
      }

      // Persist grounded candidates
      const inserted = await service.insertBatch(workspaceId, result.candidates);

      reply.status(201);
      return {
        run_id: result.runId,
        total: result.total,
        kept: result.kept,
        dropped: result.dropped,
        candidates: inserted,
      };
    },
  );

  // ---- GET /repos/:id/conventions --------------------------------------- //
  app.get(
    '/repos/:id/conventions',
    { schema: { params: IdParams } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.listByRepo(workspaceId, req.params.id);
    },
  );

  // ---- POST /repos/:id/conventions/build-skill -------------------------- //
  app.post(
    '/repos/:id/conventions/build-skill',
    {
      schema: {
        params: IdParams,
        body: z.object({
          agent_id: z.string().uuid().optional(),
          name: z.string().min(1).optional(),
          description: z.string().optional(),
          body: z.string().optional(),
        }),
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      const repoId = req.params.id;

      const accepted = await service.listAccepted(workspaceId, repoId);
      if (accepted.length === 0) throw new ValidationError('No accepted candidates — approve at least one before building a skill');

      // Use caller-supplied overrides, or generate defaults from accepted candidates
      const skillBody = req.body.body ?? renderSkillBody(accepted);
      const SKILL_NAME = req.body.name ?? 'repo-conventions';
      const skillDesc = req.body.description ?? 'Coding conventions extracted from the repository.';

      // Upsert: update body if skill already exists, otherwise create it
      const existing = await container.skillsRepo.findByName(workspaceId, SKILL_NAME);
      let skill;
      if (existing) {
        skill = await skillsService.update(workspaceId, existing.id, {
          name: SKILL_NAME,
          description: skillDesc,
          body: skillBody,
        });
      } else {
        skill = await skillsService.create(workspaceId, {
          name: SKILL_NAME,
          description: skillDesc,
          type: 'convention',
          source: 'extracted',
          body: skillBody,
        });
      }
      if (!skill) throw new ValidationError('Failed to upsert repo-conventions skill');

      // Optionally link skill to an agent (append — don't replace existing links)
      let linked = false;
      const agentId = req.body.agent_id;
      if (agentId) {
        const existingIds = await container.agentsRepo.skillIdsForAgent(agentId);
        if (!existingIds.includes(skill.id)) {
          await container.agentsRepo.setSkills(agentId, [...existingIds, skill.id]);
        }
        linked = true;
      }

      return { skill, linked };
    },
  );

  // ---- PATCH /conventions/:id ------------------------------------------ //
  app.patch(
    '/conventions/:id',
    { schema: { params: IdParams, body: UpdateConventionBody } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      const candidate = await service.updateCandidate(workspaceId, req.params.id, {
        status: req.body.status,
        rule: req.body.rule,
        category: req.body.category,
      });
      if (!candidate) throw new NotFoundError('Convention candidate not found');
      return candidate;
    },
  );
}
