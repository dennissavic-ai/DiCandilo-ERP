import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../config/database';
import { authenticate } from '../../middleware/auth.middleware';
import { handleError } from '../../utils/errors';
import { parsePagination, paginatedResponse } from '../../utils/pagination';
import { sendEmail, orderStatusTemplate, quoteFollowUpTemplate, quoteExpiryWarningTemplate, invoiceFollowUpTemplate } from '../../utils/email';

export const automationRoutes: FastifyPluginAsync = async (fastify) => {

  // ── GET /rules — list EmailAutomationRule records for this company ────────

  fastify.get('/rules', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const { companyId } = request.user as { companyId: string };
      const rules = await (prisma as any).emailAutomationRule.findMany({
        where: { companyId },
        orderBy: { trigger: 'asc' },
      });
      return rules;
    } catch (err) { return handleError(reply, err); }
  });

  // ── PUT /rules/:trigger — upsert an EmailAutomationRule ──────────────────

  fastify.put('/rules/:trigger', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const { companyId, sub } = request.user as { companyId: string; sub: string };
      const { trigger } = request.params as { trigger: string };

      const body = z.object({
        isEnabled: z.boolean(),
        subject: z.string(),
        delayHours: z.number().int().min(0),
      }).parse(request.body);

      const rule = await (prisma as any).emailAutomationRule.upsert({
        where: { companyId_trigger: { companyId, trigger } },
        update: {
          isEnabled: body.isEnabled,
          subject: body.subject,
          delayHours: body.delayHours,
          updatedBy: sub,
        },
        create: {
          companyId,
          trigger,
          isEnabled: body.isEnabled,
          subject: body.subject,
          delayHours: body.delayHours,
          updatedBy: sub,
        },
      });

      return rule;
    } catch (err) { return handleError(reply, err); }
  });

  // ── GET /logs — paginated EmailLog list ───────────────────────────────────

  fastify.get('/logs', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const { companyId } = request.user as { companyId: string };
      const { skip, take, page, limit } = parsePagination(request.query as { page?: number; limit?: number });
      const { trigger, entityType } = request.query as { trigger?: string; entityType?: string };

      const where: Record<string, unknown> = {
        companyId,
        ...(trigger && { trigger }),
        ...(entityType && { entityType }),
      };

      const [data, total] = await Promise.all([
        (prisma as any).emailLog.findMany({
          where,
          skip,
          take,
          orderBy: { sentAt: 'desc' },
        }),
        (prisma as any).emailLog.count({ where }),
      ]);

      return paginatedResponse(data, total, page, limit);
    } catch (err) { return handleError(reply, err); }
  });

  // ── POST /test-email — send a test email for a given trigger ─────────────

  fastify.post('/test-email', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const { to, trigger } = z.object({
        to: z.string().email(),
        trigger: z.string().min(1),
      }).parse(request.body);

      let html: string;
      let subject: string;

      if (trigger.startsWith('SO_')) {
        const status = trigger.replace(/^SO_/, '');
        html = orderStatusTemplate({
          orderNumber: 'SO-000001',
          status,
          customerName: 'Test Customer',
          totalAmount: 1250000, // $12,500.00 in cents
          currencyCode: 'USD',
          lines: [
            { description: 'Steel Plate 4x8 16GA', qtyOrdered: 10, unitPrice: 125000, lineTotal: 1250000, uom: 'EA' },
          ],
        });
        subject = `[TEST] Order SO-000001 — ${status}`;
      } else if (trigger === 'QUOTE_FOLLOWUP_3D' || trigger === 'QUOTE_FOLLOWUP_7D') {
        const daysOld = trigger === 'QUOTE_FOLLOWUP_3D' ? 3 : 7;
        html = quoteFollowUpTemplate({
          quoteNumber: 'QT-000001',
          customerName: 'Test Customer',
          validUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          totalAmount: 500000, // $5,000.00 in cents
          daysOld,
        });
        subject = `[TEST] Follow-up: Quote QT-000001`;
      } else if (trigger.startsWith('INVOICE_FOLLOWUP_')) {
        const daysMatch = trigger.match(/(\d+)D$/);
        const days = daysMatch ? Number(daysMatch[1]) : 7;
        html = invoiceFollowUpTemplate({
          invoiceNumber: 'INV-000001',
          customerName: 'Test Customer',
          dueDate: new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          daysOverdue: days,
          totalAmount: 1250000,
          balanceDue: 750000,
          currencyCode: 'USD',
        });
        subject = `[TEST] Payment Reminder: Invoice INV-000001 (${days} days overdue)`;
      } else if (trigger === 'QUOTE_EXPIRY_WARNING') {
        html = quoteExpiryWarningTemplate({
          quoteNumber: 'QT-000001',
          customerName: 'Test Customer',
          validUntil: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          daysUntilExpiry: 2,
          totalAmount: 500000,
        });
        subject = `[TEST] Quote QT-000001 expiring soon`;
      } else {
        // Generic test for unknown trigger
        html = orderStatusTemplate({
          orderNumber: 'TEST-001',
          status: 'CONFIRMED',
          customerName: 'Test Customer',
          totalAmount: 100000,
          currencyCode: 'USD',
        });
        subject = `[TEST] Email for trigger: ${trigger}`;
      }

      await sendEmail(to, subject, html);
      return { ok: true };
    } catch (err) { return handleError(reply, err); }
  });
};
