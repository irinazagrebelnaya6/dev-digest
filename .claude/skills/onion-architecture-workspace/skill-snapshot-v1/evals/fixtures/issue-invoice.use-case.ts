import { PostgresInvoiceRepository } from '../adapters/db/postgres-invoice.repository.js';
import type { Db } from '../../../db/client.js';
import { Invoice } from '../domain/invoice.entity.js';

export interface IssueInvoiceCommand {
  workspaceId: string;
  amountCents: number;
}

export class IssueInvoiceUseCase {
  private repo: PostgresInvoiceRepository;

  constructor(db: Db) {
    this.repo = new PostgresInvoiceRepository(db);
  }

  async execute(cmd: IssueInvoiceCommand): Promise<string> {
    const invoice = new Invoice(crypto.randomUUID(), cmd.workspaceId, cmd.amountCents, 'draft');
    await this.repo.save(invoice);
    return invoice.id;
  }
}
