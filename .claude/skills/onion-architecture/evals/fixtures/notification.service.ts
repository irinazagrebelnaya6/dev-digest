import { PostgresInvoiceRepository } from '../billing/adapters/db/postgres-invoice.repository.js';
import type { Db } from '../../db/client.js';

export interface OverdueReminder {
  invoiceId: string;
  workspaceId: string;
  amountCents: number;
}

export class NotificationService {
  private invoices: PostgresInvoiceRepository;

  constructor(db: Db, private mailer: { send(to: string, subject: string, body: string): Promise<void> }) {
    this.invoices = new PostgresInvoiceRepository(db);
  }

  async notifyOverdueInvoices(workspaceId: string): Promise<OverdueReminder[]> {
    const overdue = await this.invoices.findOverdue(workspaceId);
    const reminders: OverdueReminder[] = [];

    for (const invoice of overdue) {
      await this.mailer.send(
        invoice.billingContactEmail,
        'Invoice overdue',
        `Invoice ${invoice.id} for ${invoice.amountCents / 100} is overdue.`,
      );
      reminders.push({ invoiceId: invoice.id, workspaceId, amountCents: invoice.amountCents });
    }

    return reminders;
  }
}
