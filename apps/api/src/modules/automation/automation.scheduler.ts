import { FastifyInstance } from 'fastify';
import { prisma } from '../../config/database';
import { sendEmail, quoteFollowUpTemplate, quoteExpiryWarningTemplate, invoiceFollowUpTemplate } from '../../utils/email';

const INTERVAL_MS = 60 * 60 * 1000; // 1 hour

// ─── Scheduler Entry Point ────────────────────────────────────────────────────

export function startAutomationScheduler(fastify: FastifyInstance): void {
  fastify.log.info('[automation] Email scheduler starting (interval: 1 hour)');

  // Run immediately on startup, then every hour
  void runScheduler(fastify);
  setInterval(() => { void runScheduler(fastify); }, INTERVAL_MS);
}

// ─── Main Scheduler Loop ──────────────────────────────────────────────────────

async function runScheduler(fastify: FastifyInstance): Promise<void> {
  fastify.log.debug('[automation] Running scheduler tick');

  let companies: Array<{ id: string; name: string }> = [];

  try {
    companies = await prisma.company.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
    });
  } catch (err) {
    fastify.log.error({ err }, '[automation] Failed to fetch companies');
    return;
  }

  for (const company of companies) {
    try {
      await processCompany(fastify, company.id);
    } catch (err) {
      fastify.log.error({ err, companyId: company.id }, '[automation] Error processing company, skipping');
    }
  }
}

// ─── Per-Company Processing ───────────────────────────────────────────────────

const INVOICE_FOLLOWUP_TRIGGERS = [
  'INVOICE_FOLLOWUP_7D',
  'INVOICE_FOLLOWUP_14D',
  'INVOICE_FOLLOWUP_21D',
  'INVOICE_FOLLOWUP_30D',
] as const;

const QUOTE_TRIGGERS = ['QUOTE_FOLLOWUP_3D', 'QUOTE_FOLLOWUP_7D', 'QUOTE_EXPIRY_WARNING'] as const;

async function processCompany(fastify: FastifyInstance, companyId: string): Promise<void> {
  // Load enabled automation rules for quote and invoice triggers
  let rules: Array<{ trigger: string; isEnabled: boolean; subject: string }> = [];

  try {
    rules = await (prisma as any).emailAutomationRule.findMany({
      where: {
        companyId,
        isEnabled: true,
        trigger: { in: [...QUOTE_TRIGGERS, ...INVOICE_FOLLOWUP_TRIGGERS] },
      },
    });
  } catch (err) {
    // EmailAutomationRule table may not exist yet (schema not migrated)
    fastify.log.warn({ err, companyId }, '[automation] Could not query EmailAutomationRule — has the schema been migrated?');
    return;
  }

  if (rules.length === 0) {
    return; // No relevant rules configured for this company
  }

  const ruleMap = new Map(rules.map((r) => [r.trigger, r]));
  const now = new Date();

  // ── Quote follow-ups ───────────────────────────────────────────────────
  const hasQuoteRules = QUOTE_TRIGGERS.some((t) => ruleMap.has(t));
  if (hasQuoteRules) {
    let quotes: Array<{
      id: string;
      quoteNumber: string;
      customerId: string;
      status: string;
      createdAt: Date;
      validUntil: Date | null;
      totalAmount: bigint;
    }> = [];

    try {
      quotes = await prisma.salesQuote.findMany({
        where: {
          companyId,
          deletedAt: null,
          status: { in: ['SENT', 'DRAFT'] as any },
        },
        select: {
          id: true,
          quoteNumber: true,
          customerId: true,
          status: true,
          createdAt: true,
          validUntil: true,
          totalAmount: true,
        },
      });
    } catch (err) {
      fastify.log.error({ err, companyId }, '[automation] Failed to query SalesQuotes');
    }

    for (const quote of quotes) {
      try {
        await processQuote(fastify, companyId, quote, ruleMap, now);
      } catch (err) {
        fastify.log.error({ err, quoteId: quote.id }, '[automation] Error processing quote, skipping');
      }
    }
  }

  // ── Invoice follow-ups ─────────────────────────────────────────────────
  const hasInvoiceRules = INVOICE_FOLLOWUP_TRIGGERS.some((t) => ruleMap.has(t));
  if (hasInvoiceRules) {
    await processOverdueInvoices(fastify, companyId, ruleMap, now);
  }
}

// ─── Per-Quote Processing ─────────────────────────────────────────────────────

async function processQuote(
  fastify: FastifyInstance,
  companyId: string,
  quote: {
    id: string;
    quoteNumber: string;
    customerId: string;
    status: string;
    createdAt: Date;
    validUntil: Date | null;
    totalAmount: bigint;
  },
  ruleMap: Map<string, { trigger: string; isEnabled: boolean; subject: string }>,
  now: Date
): Promise<void> {
  const daysOld = (now.getTime() - quote.createdAt.getTime()) / (1000 * 60 * 60 * 24);

  // Resolve customer email
  const emailAddr = await resolveCustomerEmail(quote.customerId);
  if (!emailAddr) {
    fastify.log.debug({ quoteId: quote.id }, '[automation] No customer email found, skipping quote');
    return;
  }

  // Retrieve customer name for templates
  const customer = await prisma.customer.findFirst({
    where: { id: quote.customerId },
    select: { name: true },
  });
  const customerName = customer?.name ?? 'Valued Customer';

  // ── QUOTE_FOLLOWUP_3D ────────────────────────────────────────────────────
  if (daysOld >= 3 && ruleMap.has('QUOTE_FOLLOWUP_3D')) {
    const alreadySent = await hasEmailLog(quote.id, 'SalesQuote', 'QUOTE_FOLLOWUP_3D');
    if (!alreadySent) {
      const rule = ruleMap.get('QUOTE_FOLLOWUP_3D')!;
      const subject = rule.subject || `Follow-up: Quote ${quote.quoteNumber}`;
      const html = quoteFollowUpTemplate({
        quoteNumber: quote.quoteNumber,
        customerName,
        validUntil: quote.validUntil ? quote.validUntil.toISOString().split('T')[0] : null,
        totalAmount: Number(quote.totalAmount),
        daysOld,
      });
      await sendAndLog(fastify, { companyId, trigger: 'QUOTE_FOLLOWUP_3D', entityType: 'SalesQuote', entityId: quote.id, recipient: emailAddr, subject, html });
    }
  }

  // ── QUOTE_FOLLOWUP_7D ────────────────────────────────────────────────────
  if (daysOld >= 7 && ruleMap.has('QUOTE_FOLLOWUP_7D')) {
    const alreadySent = await hasEmailLog(quote.id, 'SalesQuote', 'QUOTE_FOLLOWUP_7D');
    if (!alreadySent) {
      const rule = ruleMap.get('QUOTE_FOLLOWUP_7D')!;
      const subject = rule.subject || `Follow-up: Quote ${quote.quoteNumber} (7 days)`;
      const html = quoteFollowUpTemplate({
        quoteNumber: quote.quoteNumber,
        customerName,
        validUntil: quote.validUntil ? quote.validUntil.toISOString().split('T')[0] : null,
        totalAmount: Number(quote.totalAmount),
        daysOld,
      });
      await sendAndLog(fastify, { companyId, trigger: 'QUOTE_FOLLOWUP_7D', entityType: 'SalesQuote', entityId: quote.id, recipient: emailAddr, subject, html });
    }
  }

  // ── QUOTE_EXPIRY_WARNING ─────────────────────────────────────────────────
  if (quote.validUntil && ruleMap.has('QUOTE_EXPIRY_WARNING')) {
    const msUntilExpiry = quote.validUntil.getTime() - now.getTime();
    const daysUntilExpiry = msUntilExpiry / (1000 * 60 * 60 * 24);

    if (daysUntilExpiry >= 0 && daysUntilExpiry <= 3) {
      const alreadySent = await hasEmailLog(quote.id, 'SalesQuote', 'QUOTE_EXPIRY_WARNING');
      if (!alreadySent) {
        const rule = ruleMap.get('QUOTE_EXPIRY_WARNING')!;
        const daysUntilExpiryRounded = Math.max(0, Math.ceil(daysUntilExpiry));
        const subject = rule.subject || `Quote ${quote.quoteNumber} expires in ${daysUntilExpiryRounded} day(s)`;
        const html = quoteExpiryWarningTemplate({
          quoteNumber: quote.quoteNumber,
          customerName,
          validUntil: quote.validUntil.toISOString().split('T')[0],
          daysUntilExpiry: daysUntilExpiryRounded,
          totalAmount: Number(quote.totalAmount),
        });
        await sendAndLog(fastify, { companyId, trigger: 'QUOTE_EXPIRY_WARNING', entityType: 'SalesQuote', entityId: quote.id, recipient: emailAddr, subject, html });
      }
    }
  }
}

// ─── Invoice Follow-Up Processing ─────────────────────────────────────────────

const INVOICE_DAY_TRIGGERS: Array<{ days: number; trigger: string }> = [
  { days: 30, trigger: 'INVOICE_FOLLOWUP_30D' },
  { days: 21, trigger: 'INVOICE_FOLLOWUP_21D' },
  { days: 14, trigger: 'INVOICE_FOLLOWUP_14D' },
  { days: 7,  trigger: 'INVOICE_FOLLOWUP_7D' },
];

async function processOverdueInvoices(
  fastify: FastifyInstance,
  companyId: string,
  ruleMap: Map<string, { trigger: string; isEnabled: boolean; subject: string }>,
  now: Date
): Promise<void> {
  // Find unpaid invoices past their due date
  let invoices: Array<{
    id: string;
    invoiceNumber: string;
    customerId: string;
    dueDate: Date;
    totalAmount: bigint;
    balanceDue: bigint;
    currencyCode: string;
  }> = [];

  try {
    invoices = await prisma.invoice.findMany({
      where: {
        companyId,
        deletedAt: null,
        status: { in: ['SENT', 'PARTIALLY_PAID', 'OVERDUE'] as any },
        dueDate: { lt: now },
      },
      select: {
        id: true,
        invoiceNumber: true,
        customerId: true,
        dueDate: true,
        totalAmount: true,
        balanceDue: true,
        currencyCode: true,
      },
    });
  } catch (err) {
    fastify.log.error({ err, companyId }, '[automation] Failed to query overdue invoices');
    return;
  }

  for (const invoice of invoices) {
    try {
      const daysOverdue = Math.floor((now.getTime() - invoice.dueDate.getTime()) / (1000 * 60 * 60 * 24));

      // Resolve customer email
      const emailAddr = await resolveCustomerEmail(invoice.customerId);
      if (!emailAddr) {
        fastify.log.debug({ invoiceId: invoice.id }, '[automation] No customer email found, skipping invoice');
        continue;
      }

      const customer = await prisma.customer.findFirst({
        where: { id: invoice.customerId },
        select: { name: true },
      });
      const customerName = customer?.name ?? 'Valued Customer';

      // Check each day threshold (highest first) and send the appropriate follow-up
      for (const { days, trigger } of INVOICE_DAY_TRIGGERS) {
        if (daysOverdue >= days && ruleMap.has(trigger)) {
          const alreadySent = await hasEmailLog(invoice.id, 'Invoice', trigger);
          if (!alreadySent) {
            const rule = ruleMap.get(trigger)!;
            const subject = rule.subject || `Payment Reminder: Invoice ${invoice.invoiceNumber} (${days} days overdue)`;
            const html = invoiceFollowUpTemplate({
              invoiceNumber: invoice.invoiceNumber,
              customerName,
              dueDate: invoice.dueDate.toISOString().split('T')[0],
              daysOverdue,
              totalAmount: Number(invoice.totalAmount),
              balanceDue: Number(invoice.balanceDue),
              currencyCode: invoice.currencyCode,
            });
            await sendAndLog(fastify, { companyId, trigger, entityType: 'Invoice', entityId: invoice.id, recipient: emailAddr, subject, html });
          }
        }
      }
    } catch (err) {
      fastify.log.error({ err, invoiceId: invoice.id }, '[automation] Error processing invoice, skipping');
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function resolveCustomerEmail(customerId: string): Promise<string | null> {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId },
    select: { contacts: true },
  });
  if (!customer) return null;

  const contacts = (customer.contacts as Array<{ email?: string; isPrimary?: boolean }>) ?? [];
  const fromContacts =
    contacts.find((c) => c.isPrimary && c.email)?.email ??
    contacts.find((c) => c.email)?.email ??
    null;

  return fromContacts ?? null;
}

async function hasEmailLog(entityId: string, entityType: string, trigger: string): Promise<boolean> {
  try {
    const count = await (prisma as any).emailLog.count({
      where: { entityType, entityId, trigger },
    });
    return count > 0;
  } catch {
    // If table doesn't exist yet, assume no log
    return false;
  }
}

interface SendAndLogParams {
  companyId: string;
  trigger: string;
  entityType: string;
  entityId: string;
  recipient: string;
  subject: string;
  html: string;
}

async function sendAndLog(fastify: FastifyInstance, params: SendAndLogParams): Promise<void> {
  const { companyId, trigger, entityType, entityId, recipient, subject, html } = params;

  try {
    await sendEmail(recipient, subject, html);
    fastify.log.info({ trigger, entityType, entityId, recipient }, '[automation] Email sent');
  } catch (err) {
    fastify.log.error({ err, trigger, entityId }, '[automation] Failed to send email');
    // Still log the attempt with error status
    try {
      await (prisma as any).emailLog.create({
        data: {
          companyId,
          trigger,
          entityType,
          entityId,
          recipient,
          subject,
          status: 'FAILED',
          errorMsg: err instanceof Error ? err.message : String(err),
        },
      });
    } catch (logErr) {
      fastify.log.error({ logErr }, '[automation] Failed to write EmailLog');
    }
    return;
  }

  try {
    await (prisma as any).emailLog.create({
      data: {
        companyId,
        trigger,
        entityType,
        entityId,
        recipient,
        subject,
        status: 'SENT',
      },
    });
  } catch (logErr) {
    fastify.log.error({ logErr }, '[automation] Failed to write EmailLog after successful send');
  }
}
