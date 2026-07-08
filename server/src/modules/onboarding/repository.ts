import { eq } from 'drizzle-orm';
import type { Onboarding } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

export type OnboardingRow = typeof t.onboarding.$inferSelect;

/**
 * onboarding module data-access layer — the ONLY place that touches the
 * pre-created `onboarding` table (`repoId` PK, `json`, `generatedAt`).
 * AC-14 (first-view persist) / AC-17 (stored tour served with zero calls).
 */
export class OnboardingRepository {
  constructor(private db: Db) {}

  async getByRepoId(repoId: string): Promise<OnboardingRow | undefined> {
    const [row] = await this.db.select().from(t.onboarding).where(eq(t.onboarding.repoId, repoId));
    return row;
  }

  /** Insert-or-replace the tour for a repo; bumps `generatedAt` to now(). */
  async upsert(repoId: string, tour: Onboarding): Promise<OnboardingRow> {
    const now = new Date();
    const [row] = await this.db
      .insert(t.onboarding)
      .values({ repoId, json: tour, generatedAt: now })
      .onConflictDoUpdate({
        target: t.onboarding.repoId,
        set: { json: tour, generatedAt: now },
      })
      .returning();
    return row!;
  }
}
