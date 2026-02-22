import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../config/database';
import { authenticate, requirePermission } from '../../middleware/auth.middleware';
import { handleError, NotFoundError, ValidationError } from '../../utils/errors';
import { parsePagination, paginatedResponse } from '../../utils/pagination';

export const accountingRoutes: FastifyPluginAsync = async (fastify) => {

  // ── Chart of Accounts ───────────────────────────────────────────────────────

  fastify.get('/accounts', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const { companyId } = request.user as { companyId: string };
      const { type } = request.query as { type?: string };
      const accounts = await prisma.gLAccount.findMany({
        where: { companyId, deletedAt: null, isActive: true, ...(type && { type: type as 'ASSET' }) },
        orderBy: { code: 'asc' },
        include: { children: { where: { deletedAt: null }, orderBy: { code: 'asc' } } },
      });
      return accounts;
    } catch (err) { return handleError(reply, err); }
  });

  fastify.post('/accounts', { preHandler: [authenticate, requirePermission('accounting', 'create')] }, async (request, reply) => {
    try {
      const { companyId } = request.user as { companyId: string };
      const body = z.object({
        code: z.string().min(1),
        name: z.string().min(1),
        type: z.enum(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE', 'COGS']),
        normalBalance: z.enum(['DEBIT', 'CREDIT']).optional(),
        parentId: z.string().uuid().optional(),
      }).parse(request.body);
      const account = await prisma.gLAccount.create({ data: { companyId, ...body } });
      return reply.status(201).send(account);
    } catch (err) { return handleError(reply, err); }
  });

  // ── Journal Entries ─────────────────────────────────────────────────────────

  fastify.get('/journal-entries', { preHandler: [authenticate, requirePermission('accounting', 'view')] }, async (request, reply) => {
    try {
      const { companyId } = request.user as { companyId: string };
      const { skip, take, page, limit } = parsePagination(request.query as { page?: number; limit?: number });
      const { period } = request.query as { period?: string };
      const where = { companyId, ...(period && { period }) };
      const [data, total] = await Promise.all([
        prisma.journalEntry.findMany({ where, skip, take, orderBy: { postingDate: 'desc' }, include: { lines: { include: { glAccount: { select: { code: true, name: true } } } } } }),
        prisma.journalEntry.count({ where }),
      ]);
      return paginatedResponse(data, total, page, limit);
    } catch (err) { return handleError(reply, err); }
  });

  fastify.post('/journal-entries', { preHandler: [authenticate, requirePermission('accounting', 'create')] }, async (request, reply) => {
    try {
      const { companyId, sub } = request.user as { companyId: string; sub: string };
      const body = z.object({
        description: z.string().min(1),
        postingDate: z.string().datetime(),
        lines: z.array(z.object({
          glAccountId: z.string().uuid(),
          description: z.string().optional(),
          debitAmount: z.number().int().min(0).default(0),
          creditAmount: z.number().int().min(0).default(0),
        })).min(2),
      }).parse(request.body);

      const totalDebits = body.lines.reduce((s, l) => s + l.debitAmount, 0);
      const totalCredits = body.lines.reduce((s, l) => s + l.creditAmount, 0);
      if (totalDebits !== totalCredits) throw new ValidationError(`Journal entry is not balanced. Debits: ${totalDebits}, Credits: ${totalCredits}`);

      const postingDate = new Date(body.postingDate);
      const period = `${postingDate.getFullYear()}-${String(postingDate.getMonth() + 1).padStart(2, '0')}`;
      const count = await prisma.journalEntry.count({ where: { companyId } });
      const entryNumber = `JE-${String(count + 1).padStart(6, '0')}`;

      const je = await prisma.journalEntry.create({
        data: {
          companyId,
          entryNumber,
          description: body.description,
          postingDate,
          period,
          createdBy: sub,
          lines: {
            create: body.lines.map((l) => ({
              companyId,
              glAccountId: l.glAccountId,
              journalEntryId: '',
              description: l.description ?? body.description,
              debitAmount: l.debitAmount,
              creditAmount: l.creditAmount,
              postingDate,
              period,
              createdBy: sub,
            })),
          },
        },
        include: { lines: { include: { glAccount: { select: { code: true, name: true } } } } },
      });
      return reply.status(201).send(je);
    } catch (err) { return handleError(reply, err); }
  });

  // ── Invoices (AR) ───────────────────────────────────────────────────────────

  fastify.get('/invoices', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const { companyId } = request.user as { companyId: string };
      const { skip, take, page, limit } = parsePagination(request.query as { page?: number; limit?: number });
      const { status, customerId, overdue } = request.query as { status?: string; customerId?: string; overdue?: string };
      const where = {
        companyId, deletedAt: null,
        ...(status && { status: status as 'DRAFT' }),
        ...(customerId && { customerId }),
        ...(overdue === 'true' && { dueDate: { lt: new Date() }, status: { not: 'PAID' as const } }),
      };
      const [data, total] = await Promise.all([
        prisma.invoice.findMany({
          where, skip, take, orderBy: { invoiceDate: 'desc' },
          include: { customer: { select: { id: true, name: true, code: true } } },
        }),
        prisma.invoice.count({ where }),
      ]);
      return paginatedResponse(data, total, page, limit);
    } catch (err) { return handleError(reply, err); }
  });

  fastify.get('/invoices/:id', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const { companyId } = request.user as { companyId: string };
      const { id } = request.params as { id: string };
      const inv = await prisma.invoice.findFirst({
        where: { id, companyId, deletedAt: null },
        include: { customer: true, lines: true, payments: true },
      });
      if (!inv) throw new NotFoundError('Invoice', id);
      return inv;
    } catch (err) { return handleError(reply, err); }
  });

  // Generate invoice from sales order (manual trigger — auto-trigger happens on shipment)
  fastify.post('/invoices/from-order/:salesOrderId', { preHandler: [authenticate, requirePermission('accounting', 'create')] }, async (request, reply) => {
    try {
      const { companyId, sub } = request.user as { companyId: string; sub: string };
      const { salesOrderId } = request.params as { salesOrderId: string };

      const so = await prisma.salesOrder.findFirst({
        where: { id: salesOrderId, companyId, deletedAt: null },
        include: { lines: true, customer: true, invoices: { where: { deletedAt: null } } },
      });
      if (!so) throw new NotFoundError('SalesOrder', salesOrderId);
      if ((so as any).invoices.length > 0) throw new ValidationError('An invoice already exists for this order');

      const count = await prisma.invoice.count({ where: { companyId } });
      const invoiceNumber = `INV-${String(count + 1).padStart(6, '0')}`;
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + (so.customer.creditTerms ?? 30));

      const invoice = await prisma.invoice.create({
        data: {
          companyId,
          customerId: so.customerId,
          salesOrderId: so.id,
          invoiceNumber,
          dueDate,
          currencyCode: so.currencyCode,
          subtotal: so.subtotal,
          discountAmount: so.discountAmount,
          taxAmount: so.taxAmount,
          freightAmount: so.freightAmount,
          totalAmount: so.totalAmount,
          balanceDue: so.totalAmount,
          terms: so.terms,
          notes: so.notes,
          createdBy: sub,
          updatedBy: sub,
          lines: {
            create: so.lines.map((l) => ({
              salesOrderLineId: l.id,
              lineNumber: l.lineNumber,
              description: l.description,
              uom: l.uom,
              qty: l.qtyOrdered,
              unitPrice: l.unitPrice,
              discountPct: l.discountPct,
              lineSubtotal: l.lineTotal,
              lineTotal: l.lineTotal,
            })),
          },
          status: 'SENT',
        },
        include: { lines: true },
      });

      await postInvoiceToGL(companyId, invoice.id, Number(so.totalAmount), sub);
      return reply.status(201).send(invoice);
    } catch (err) { return handleError(reply, err); }
  });

  // Record customer payment — updates AR and posts GL (DR Cash / CR AR)
  fastify.post('/invoices/:id/payments', { preHandler: [authenticate, requirePermission('accounting', 'create')] }, async (request, reply) => {
    try {
      const { companyId, sub } = request.user as { companyId: string; sub: string };
      const { id } = request.params as { id: string };
      const body = z.object({
        amount: z.number().int().positive(),
        paymentDate: z.string().datetime(),
        method: z.enum(['CASH', 'CHECK', 'CREDIT_CARD', 'BANK_TRANSFER', 'ACH', 'WIRE']),
        reference: z.string().optional(),
        notes: z.string().optional(),
      }).parse(request.body);

      const inv = await prisma.invoice.findFirst({ where: { id, companyId, deletedAt: null } });
      if (!inv) throw new NotFoundError('Invoice', id);

      const newAmountPaid = Number(inv.amountPaid) + body.amount;
      const newBalance = Number(inv.totalAmount) - newAmountPaid;
      const newStatus = newBalance <= 0 ? 'PAID' : 'PARTIALLY_PAID';

      const [payment] = await prisma.$transaction([
        prisma.payment.create({
          data: {
            companyId,
            customerId: inv.customerId,
            invoiceId: id,
            paymentDate: new Date(body.paymentDate),
            amount: body.amount,
            method: body.method,
            reference: body.reference,
            notes: body.notes,
            createdBy: sub,
          },
        }),
        prisma.invoice.update({
          where: { id },
          data: { amountPaid: newAmountPaid, balanceDue: Math.max(0, newBalance), status: newStatus, updatedBy: sub },
        }),
      ]);

      // GL: DR Cash/Bank (1000) / CR Accounts Receivable (1100)
      postPaymentToGL(companyId, id, payment.id, body.amount, sub).catch((e) =>
        console.error('[GL] Payment posting failed:', e)
      );

      return reply.status(201).send(payment);
    } catch (err) { return handleError(reply, err); }
  });

  // ── AR Aging Report ─────────────────────────────────────────────────────────

  fastify.get('/ar-aging', { preHandler: [authenticate, requirePermission('accounting', 'view')] }, async (request, reply) => {
    try {
      const { companyId } = request.user as { companyId: string };
      const now = new Date();

      const invoices = await prisma.invoice.findMany({
        where: { companyId, deletedAt: null, status: { notIn: ['PAID', 'CANCELLED', 'WRITTEN_OFF'] } },
        include: { customer: { select: { id: true, name: true, code: true } } },
      });

      const buckets = { current: 0, days30: 0, days60: 0, days90: 0, over90: 0 };
      const customerTotals: Record<string, { name: string; current: number; days30: number; days60: number; days90: number; over90: number; total: number }> = {};

      for (const inv of invoices) {
        const daysOverdue = Math.floor((now.getTime() - inv.dueDate.getTime()) / 86400000);
        const balance = Number(inv.balanceDue);
        const cid = inv.customerId;

        if (!customerTotals[cid]) customerTotals[cid] = { name: inv.customer.name, current: 0, days30: 0, days60: 0, days90: 0, over90: 0, total: 0 };
        customerTotals[cid].total += balance;

        if (daysOverdue <= 0) { buckets.current += balance; customerTotals[cid].current += balance; }
        else if (daysOverdue <= 30) { buckets.days30 += balance; customerTotals[cid].days30 += balance; }
        else if (daysOverdue <= 60) { buckets.days60 += balance; customerTotals[cid].days60 += balance; }
        else if (daysOverdue <= 90) { buckets.days90 += balance; customerTotals[cid].days90 += balance; }
        else { buckets.over90 += balance; customerTotals[cid].over90 += balance; }
      }

      return { summary: buckets, customers: Object.values(customerTotals) };
    } catch (err) { return handleError(reply, err); }
  });

  // ── AP (Supplier Invoices) ──────────────────────────────────────────────────

  fastify.get('/ap-invoices', { preHandler: [authenticate, requirePermission('accounting', 'view')] }, async (request, reply) => {
    try {
      const { companyId } = request.user as { companyId: string };
      const { skip, take, page, limit } = parsePagination(request.query as { page?: number; limit?: number });
      const { status, supplierId, overdue } = request.query as { status?: string; supplierId?: string; overdue?: string };
      const where = {
        companyId: companyId,
        ...(status && { status: status as 'PENDING' }),
        ...(supplierId && { supplierId }),
        ...(overdue === 'true' && { dueDate: { lt: new Date() }, status: { not: 'PAID' as const } }),
      };
      const [data, total] = await Promise.all([
        prisma.supplierInvoice.findMany({
          where, skip, take, orderBy: { invoiceDate: 'desc' },
          include: { supplier: { select: { name: true, code: true } } },
        }),
        prisma.supplierInvoice.count({ where }),
      ]);
      return paginatedResponse(data, total, page, limit);
    } catch (err) { return handleError(reply, err); }
  });

  // Create supplier invoice + post GL (DR Inventory/Expense / CR AP)
  fastify.post('/ap-invoices', { preHandler: [authenticate, requirePermission('accounting', 'create')] }, async (request, reply) => {
    try {
      const { companyId, sub } = request.user as { companyId: string; sub: string };
      const body = z.object({
        supplierId: z.string().uuid(),
        purchaseOrderId: z.string().uuid().optional(),
        invoiceNumber: z.string().min(1),
        invoiceDate: z.string().datetime(),
        dueDate: z.string().datetime(),
        totalAmount: z.number().int().positive(),
        taxAmount: z.number().int().min(0).default(0),
        notes: z.string().optional(),
        // GL account to debit (defaults to Inventory 1200 for stock purchases)
        debitAccountCode: z.string().default('1200'),
      }).parse(request.body);

      const supplierInv = await prisma.supplierInvoice.create({
        data: {
          companyId,
          supplierId: body.supplierId,
          purchaseOrderId: body.purchaseOrderId,
          invoiceNumber: body.invoiceNumber,
          invoiceDate: new Date(body.invoiceDate),
          dueDate: new Date(body.dueDate),
          totalAmount: body.totalAmount,
          taxAmount: body.taxAmount,
          amountPaid: 0,
          notes: body.notes,
          createdBy: sub,
          updatedBy: sub,
        },
      });

      // GL: DR (debitAccountCode) / CR Accounts Payable (2000)
      postAPInvoiceToGL(companyId, supplierInv.id, body.totalAmount, body.debitAccountCode, sub).catch((e) =>
        console.error('[GL] AP invoice posting failed:', e)
      );

      return reply.status(201).send(supplierInv);
    } catch (err) { return handleError(reply, err); }
  });

  // Record supplier payment + GL (DR AP / CR Cash)
  fastify.post('/ap-invoices/:id/payments', { preHandler: [authenticate, requirePermission('accounting', 'create')] }, async (request, reply) => {
    try {
      const { companyId, sub } = request.user as { companyId: string; sub: string };
      const { id } = request.params as { id: string };
      const body = z.object({
        amount: z.number().int().positive(),
        paymentDate: z.string().datetime(),
        method: z.enum(['CASH', 'CHECK', 'CREDIT_CARD', 'BANK_TRANSFER', 'ACH', 'WIRE']),
        reference: z.string().optional(),
        notes: z.string().optional(),
      }).parse(request.body);

      const inv = await prisma.supplierInvoice.findFirst({ where: { id, companyId } });
      if (!inv) throw new NotFoundError('SupplierInvoice', id);

      const newAmountPaid = Number(inv.amountPaid) + body.amount;
      const newBalance = Number(inv.totalAmount) - newAmountPaid;
      const newStatus = newBalance <= 0 ? 'PAID' : 'PARTIALLY_PAID';

      const [payment] = await prisma.$transaction([
        prisma.supplierPayment.create({
          data: {
            supplierInvoiceId: id,
            supplierId: inv.supplierId,
            paymentDate: new Date(body.paymentDate),
            amount: body.amount,
            method: body.method,
            reference: body.reference,
            notes: body.notes,
            createdBy: sub,
          },
        }),
        prisma.supplierInvoice.update({
          where: { id },
          data: { amountPaid: newAmountPaid, status: newStatus, updatedBy: sub },
        }),
      ]);

      // GL: DR Accounts Payable (2000) / CR Cash/Bank (1000)
      postAPPaymentToGL(companyId, id, payment.id, body.amount, sub).catch((e) =>
        console.error('[GL] AP payment posting failed:', e)
      );

      return reply.status(201).send(payment);
    } catch (err) { return handleError(reply, err); }
  });

  // ── Trial Balance ───────────────────────────────────────────────────────────

  fastify.get('/trial-balance', { preHandler: [authenticate, requirePermission('accounting', 'view')] }, async (request, reply) => {
    try {
      const { companyId } = request.user as { companyId: string };
      const { period } = request.query as { period?: string };
      const where = { companyId, ...(period && { period }) };

      const lines = await prisma.gLTransaction.groupBy({
        by: ['glAccountId'],
        where,
        _sum: { debitAmount: true, creditAmount: true },
      });

      const accounts = await prisma.gLAccount.findMany({ where: { companyId, deletedAt: null } });
      const accountMap = new Map(accounts.map((a) => [a.id, a]));

      const rows = lines.map((l) => {
        const acct = accountMap.get(l.glAccountId);
        const debits = Number(l._sum.debitAmount ?? 0);
        const credits = Number(l._sum.creditAmount ?? 0);
        return {
          accountId: l.glAccountId,
          code: acct?.code,
          name: acct?.name,
          type: acct?.type,
          debits,
          credits,
          balance: debits - credits,
        };
      });

      const totalDebits = rows.reduce((s, r) => s + r.debits, 0);
      const totalCredits = rows.reduce((s, r) => s + r.credits, 0);

      return { rows, totalDebits, totalCredits, isBalanced: totalDebits === totalCredits };
    } catch (err) { return handleError(reply, err); }
  });

  // ── Profit & Loss Statement ─────────────────────────────────────────────────

  fastify.get('/profit-loss', { preHandler: [authenticate, requirePermission('accounting', 'view')] }, async (request, reply) => {
    try {
      const { companyId } = request.user as { companyId: string };
      const { from, to } = z.object({
        from: z.string().regex(/^\d{4}-\d{2}$/, 'Use YYYY-MM format'),
        to: z.string().regex(/^\d{4}-\d{2}$/, 'Use YYYY-MM format'),
      }).parse(request.query);

      // Pull all GL transactions in the period range by GL account type
      const accounts = await prisma.gLAccount.findMany({
        where: { companyId, deletedAt: null, type: { in: ['REVENUE', 'COGS', 'EXPENSE'] } },
        orderBy: { code: 'asc' },
      });

      const txns = await prisma.gLTransaction.groupBy({
        by: ['glAccountId'],
        where: { companyId, period: { gte: from, lte: to } },
        _sum: { debitAmount: true, creditAmount: true },
      });
      const txnMap = new Map(txns.map((t) => [t.glAccountId, t]));

      const rows = accounts.map((acct) => {
        const t = txnMap.get(acct.id);
        const debits = Number(t?._sum.debitAmount ?? 0);
        const credits = Number(t?._sum.creditAmount ?? 0);
        // Revenue accounts: normal credit balance — net = credits - debits
        // COGS/Expense accounts: normal debit balance — net = debits - credits
        const net = acct.type === 'REVENUE' ? credits - debits : debits - credits;
        return { accountId: acct.id, code: acct.code, name: acct.name, type: acct.type, net };
      });

      const revenue = rows.filter((r) => r.type === 'REVENUE').reduce((s, r) => s + r.net, 0);
      const cogs = rows.filter((r) => r.type === 'COGS').reduce((s, r) => s + r.net, 0);
      const expenses = rows.filter((r) => r.type === 'EXPENSE').reduce((s, r) => s + r.net, 0);
      const grossProfit = revenue - cogs;
      const netIncome = grossProfit - expenses;

      return {
        period: { from, to },
        revenue,
        cogs,
        grossProfit,
        grossMarginPct: revenue > 0 ? Math.round((grossProfit / revenue) * 10000) / 100 : 0,
        expenses,
        netIncome,
        rows,
      };
    } catch (err) { return handleError(reply, err); }
  });

  // ── Balance Sheet ───────────────────────────────────────────────────────────

  fastify.get('/balance-sheet', { preHandler: [authenticate, requirePermission('accounting', 'view')] }, async (request, reply) => {
    try {
      const { companyId } = request.user as { companyId: string };
      const { asOf } = z.object({
        asOf: z.string().regex(/^\d{4}-\d{2}$/, 'Use YYYY-MM format').optional(),
      }).parse(request.query);

      const accounts = await prisma.gLAccount.findMany({
        where: { companyId, deletedAt: null, type: { in: ['ASSET', 'LIABILITY', 'EQUITY'] } },
        orderBy: { code: 'asc' },
      });

      const txns = await prisma.gLTransaction.groupBy({
        by: ['glAccountId'],
        where: { companyId, ...(asOf && { period: { lte: asOf } }) },
        _sum: { debitAmount: true, creditAmount: true },
      });
      const txnMap = new Map(txns.map((t) => [t.glAccountId, t]));

      const rows = accounts.map((acct) => {
        const t = txnMap.get(acct.id);
        const debits = Number(t?._sum.debitAmount ?? 0);
        const credits = Number(t?._sum.creditAmount ?? 0);
        // Assets: normal debit — balance = debits - credits
        // Liabilities & Equity: normal credit — balance = credits - debits
        const balance = acct.type === 'ASSET' ? debits - credits : credits - debits;
        return { accountId: acct.id, code: acct.code, name: acct.name, type: acct.type, balance };
      });

      const totalAssets = rows.filter((r) => r.type === 'ASSET').reduce((s, r) => s + r.balance, 0);
      const totalLiabilities = rows.filter((r) => r.type === 'LIABILITY').reduce((s, r) => s + r.balance, 0);
      const totalEquity = rows.filter((r) => r.type === 'EQUITY').reduce((s, r) => s + r.balance, 0);
      const isBalanced = Math.abs(totalAssets - totalLiabilities - totalEquity) < 1; // penny tolerance

      return {
        asOf: asOf ?? 'all periods',
        totalAssets,
        totalLiabilities,
        totalEquity,
        isBalanced,
        rows,
      };
    } catch (err) { return handleError(reply, err); }
  });
};

// ── GL Helper Functions ─────────────────────────────────────────────────────

async function postInvoiceToGL(companyId: string, invoiceId: string, amount: number, userId: string) {
  const now = new Date();
  const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [arAccount, revenueAccount] = await Promise.all([
    prisma.gLAccount.findFirst({ where: { companyId, code: '1100' } }),
    prisma.gLAccount.findFirst({ where: { companyId, code: '4000' } }),
  ]);
  if (!arAccount || !revenueAccount) return;
  const count = await prisma.journalEntry.count({ where: { companyId } });
  await prisma.journalEntry.create({
    data: {
      companyId,
      entryNumber: `JE-AUTO-${String(count + 1).padStart(6, '0')}`,
      description: `Invoice ${invoiceId} posted`,
      postingDate: now,
      period,
      createdBy: userId,
      lines: {
        create: [
          { companyId, glAccountId: arAccount.id, description: 'Accounts Receivable', debitAmount: amount, creditAmount: 0, postingDate: now, period, sourceType: 'INVOICE', sourceId: invoiceId, invoiceId, createdBy: userId },
          { companyId, glAccountId: revenueAccount.id, description: 'Sales Revenue', debitAmount: 0, creditAmount: amount, postingDate: now, period, sourceType: 'INVOICE', sourceId: invoiceId, invoiceId, createdBy: userId },
        ],
      },
    },
  });
}

/** GL: DR Cash/Bank (1000) / CR Accounts Receivable (1100) */
async function postPaymentToGL(companyId: string, invoiceId: string, paymentId: string, amount: number, userId: string) {
  const now = new Date();
  const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [cashAccount, arAccount] = await Promise.all([
    prisma.gLAccount.findFirst({ where: { companyId, code: '1000' } }),
    prisma.gLAccount.findFirst({ where: { companyId, code: '1100' } }),
  ]);
  if (!cashAccount || !arAccount) return;
  const count = await prisma.journalEntry.count({ where: { companyId } });
  await prisma.journalEntry.create({
    data: {
      companyId,
      entryNumber: `JE-AUTO-${String(count + 1).padStart(6, '0')}`,
      description: `Customer payment received on invoice ${invoiceId}`,
      postingDate: now,
      period,
      createdBy: userId,
      lines: {
        create: [
          { companyId, glAccountId: cashAccount.id, description: 'Cash received', debitAmount: amount, creditAmount: 0, postingDate: now, period, sourceType: 'PAYMENT', sourceId: paymentId, paymentId, createdBy: userId },
          { companyId, glAccountId: arAccount.id, description: 'Accounts Receivable cleared', debitAmount: 0, creditAmount: amount, postingDate: now, period, sourceType: 'PAYMENT', sourceId: paymentId, paymentId, createdBy: userId },
        ],
      },
    },
  });
}

/** GL: DR debitAccountCode (default Inventory 1200) / CR Accounts Payable (2000) */
async function postAPInvoiceToGL(companyId: string, supplierInvId: string, amount: number, debitCode: string, userId: string) {
  const now = new Date();
  const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [debitAcct, apAcct] = await Promise.all([
    prisma.gLAccount.findFirst({ where: { companyId, code: debitCode } }),
    prisma.gLAccount.findFirst({ where: { companyId, code: '2000' } }),
  ]);
  if (!debitAcct || !apAcct) return;
  const count = await prisma.journalEntry.count({ where: { companyId } });
  await prisma.journalEntry.create({
    data: {
      companyId,
      entryNumber: `JE-AUTO-${String(count + 1).padStart(6, '0')}`,
      description: `Supplier invoice ${supplierInvId} posted`,
      postingDate: now,
      period,
      createdBy: userId,
      lines: {
        create: [
          { companyId, glAccountId: debitAcct.id, description: debitAcct.name, debitAmount: amount, creditAmount: 0, postingDate: now, period, sourceType: 'PO', sourceId: supplierInvId, supplierInvId, createdBy: userId },
          { companyId, glAccountId: apAcct.id, description: 'Accounts Payable', debitAmount: 0, creditAmount: amount, postingDate: now, period, sourceType: 'PO', sourceId: supplierInvId, supplierInvId, createdBy: userId },
        ],
      },
    },
  });
}

/** GL: DR Accounts Payable (2000) / CR Cash/Bank (1000) */
async function postAPPaymentToGL(companyId: string, supplierInvId: string, paymentId: string, amount: number, userId: string) {
  const now = new Date();
  const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [apAcct, cashAcct] = await Promise.all([
    prisma.gLAccount.findFirst({ where: { companyId, code: '2000' } }),
    prisma.gLAccount.findFirst({ where: { companyId, code: '1000' } }),
  ]);
  if (!apAcct || !cashAcct) return;
  const count = await prisma.journalEntry.count({ where: { companyId } });
  await prisma.journalEntry.create({
    data: {
      companyId,
      entryNumber: `JE-AUTO-${String(count + 1).padStart(6, '0')}`,
      description: `Supplier payment ${paymentId} on invoice ${supplierInvId}`,
      postingDate: now,
      period,
      createdBy: userId,
      lines: {
        create: [
          { companyId, glAccountId: apAcct.id, description: 'Accounts Payable cleared', debitAmount: amount, creditAmount: 0, postingDate: now, period, sourceType: 'PAYMENT', sourceId: paymentId, createdBy: userId },
          { companyId, glAccountId: cashAcct.id, description: 'Cash paid to supplier', debitAmount: 0, creditAmount: amount, postingDate: now, period, sourceType: 'PAYMENT', sourceId: paymentId, createdBy: userId },
        ],
      },
    },
  });
}
