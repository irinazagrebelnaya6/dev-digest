import { invoicesTable } from '../../../db/schema/invoices.js';

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'void';

export class Invoice {
  constructor(
    readonly id: string,
    readonly workspaceId: string,
    private amountCents: number,
    private status: InvoiceStatus,
  ) {}

  markPaid(): void {
    if (this.status === 'void') {
      throw new Error('Cannot mark a void invoice as paid');
    }
    this.status = 'paid';
  }

  toRow(): typeof invoicesTable.$inferInsert {
    return {
      id: this.id,
      workspaceId: this.workspaceId,
      amountCents: this.amountCents,
      status: this.status,
    };
  }

  get amount(): number {
    return this.amountCents / 100;
  }
}
