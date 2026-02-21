import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../config/database';
import { authenticate, requirePermission } from '../../middleware/auth.middleware';
import { writeAuditLog } from '../../middleware/audit.middleware';
import { handleError, NotFoundError, ConflictError, ValidationError } from '../../utils/errors';
import { parsePagination, paginatedResponse } from '../../utils/pagination';

export const salesRoutes: FastifyPluginAsync = async (fastify) => {

  // ── Customers ───────────────────────────────────────────────────────────────

  fastify.get('/customers', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const { companyId } = request.user as { companyId: string };
      const { skip, take, page, limit } = parsePagination(request.query as { page?: number; limit?: number });
      const { search, creditHold } = request.query as { search?: string; creditHold?: string };
      const where = {
        companyId, deletedAt: null,
        ...(creditHold !== undefined && { creditHold: creditHold === 'true' }),
        ...(search && { OR: [
          { name: { contains: search, mode: 'insensitive' as const } },
          { code: { contains: search, mode: 'insensitive' as const } },
        ]}),
      };
      const [data, total] = await Promise.all([
        prisma.customer.findMany({
          where, skip, take, orderBy: { name: 'asc' },
          include: { customerGroup: { select: { id: true, name: true } } },
        }),
        prisma.customer.count({ where }),
      ]);
      return paginatedResponse(data, total, page, limit);
    } catch (err) { return handleError(reply, err); }
  });

  fastify.get('/customers/:id', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const { companyId } = request.user as { companyId: string };
      const { id } = request.params as { id: string };
      const c = await prisma.customer.findFirst({
        where: { id, companyId, deletedAt: null },
        include: {
          customerGroup: true,
          salesOrders: { take: 10, orderBy: { createdAt: 'desc' }, select: { id: true, orderNumber: true, status: true, totalAmount: true, orderDate: true } },
          invoices: { take: 10, orderBy: { createdAt: 'desc' }, select: { id: true, invoiceNumber: true, status: true, totalAmount: true, balanceDue: true, dueDate: true } },
        },
      });
      if (!c) throw new NotFoundError('Customer', id);
      return c;
    } catch (err) { return handleError(reply, err); }
  });

  fastify.post('/customers', { preHandler: [authenticate, requirePermission('sales', 'create')] }, async (request, reply) => {
    try {
      const { companyId, sub } = request.user as { companyId: string; sub: string };
      const body = z.object({
        code: z.string().min(1),
        name: z.string().min(1),
        legalName: z.string().optional(),
        taxId: z.string().optional(),
        customerGroupId: z.string().uuid().optional(),
        currencyCode: z.string().default('USD'),
        creditLimit: z.number().int().min(0).default(0),
        creditTerms: z.number().int().min(0).default(30),
        billingAddress: z.record(z.unknown()).optional(),
        shippingAddress: z.record(z.unknown()).optional(),
        contacts: z.array(z.record(z.unknown())).optional(),
        taxExempt: z.boolean().optional(),
        taxExemptNumber: z.string().optional(),
        notes: z.string().optional(),
      }).parse(request.body);
      const existing = await prisma.customer.findFirst({ where: { companyId, code: body.code, deletedAt: null } });
      if (existing) throw new ConflictError(`Customer code '${body.code}' already exists`);
      const customer = await prisma.customer.create({ data: { companyId, ...body, createdBy: sub, updatedBy: sub } });
      return reply.status(201).send(customer);
    } catch (err) { return handleError(reply, err); }
  });

  fastify.put('/customers/:id', { preHandler: [authenticate, requirePermission('sales', 'edit')] }, async (request, reply) => {
    try {
      const { companyId, sub } = request.user as { companyId: string; sub: string };
      const { id } = request.params as { id: string };
      const c = await prisma.customer.findFirst({ where: { id, companyId, deletedAt: null } });
      if (!c) throw new NotFoundError('Customer', id);
      const updated = await prisma.customer.update({ where: { id }, data: { ...(request.body as object), updatedBy: sub } });
      return updated;
    } catch (err) { return handleError(reply, err); }
  });

  // ── Sales Quotes ────────────────────────────────────────────────────────────

  fastify.get('/quotes', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const { companyId } = request.user as { companyId: string };
      const { skip, take, page, limit } = parsePagination(request.query as { page?: number; limit?: number });
      const { status, customerId } = request.query as { status?: string; customerId?: string };
      const where = {
        companyId, deletedAt: null,
        ...(status && { status: status as 'DRAFT' }),
        ...(customerId && { customerId }),
      };
      const [data, total] = await Promise.all([
        prisma.salesQuote.findMany({
          where, skip, take, orderBy: { createdAt: 'desc' },
          include: { customer: { select: { id: true, name: true, code: true } } },
        }),
        prisma.salesQuote.count({ where }),
      ]);
      return paginatedResponse(data, total, page, limit);
    } catch (err) { return handleError(reply, err); }
  });

  fastify.get('/quotes/:id', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const { companyId } = request.user as { companyId: string };
      const { id } = request.params as { id: string };
      const q = await prisma.salesQuote.findFirst({
        where: { id, companyId, deletedAt: null },
        include: { customer: true, lines: { include: { product: { select: { id: true, code: true, description: true, uom: true } } } } },
      });
      if (!q) throw new NotFoundError('SalesQuote', id);
      return q;
    } catch (err) { return handleError(reply, err); }
  });

  const quoteLineSchema = z.object({
    productId: z.string().uuid().optional(),
    description: z.string().min(1),
    uom: z.string(),
    qty: z.number().positive(),
    unitPrice: z.number().int().min(0),
    discountPct: z.number().min(0).max(100).default(0),
    thickness: z.number().int().positive().optional(),
    width: z.number().int().positive().optional(),
    length: z.number().int().positive().optional(),
    notes: z.string().optional(),
  });

  fastify.post('/quotes', { preHandler: [authenticate, requirePermission('sales', 'create')] }, async (request, reply) => {
    try {
      const { companyId, branchId, sub } = request.user as { companyId: string; branchId: string; sub: string };
      const body = z.object({
        customerId: z.string().uuid(),
        validUntil: z.string().datetime().optional(),
        currencyCode: z.string().default('USD'),
        discountAmount: z.number().int().min(0).default(0),
        taxAmount: z.number().int().min(0).default(0),
        terms: z.string().optional(),
        notes: z.string().optional(),
        lines: z.array(quoteLineSchema).min(1),
      }).parse(request.body);

      // Check credit hold
      const customer = await prisma.customer.findFirst({ where: { id: body.customerId, companyId } });
      if (!customer) throw new NotFoundError('Customer', body.customerId);
      if (customer.creditHold) throw new ValidationError('Customer is on credit hold');

      const count = await prisma.salesQuote.count({ where: { companyId } });
      const quoteNumber = `QT-${String(count + 1).padStart(6, '0')}`;

      const subtotal = body.lines.reduce((sum, l) => {
        const lineSubtotal = Math.round(l.qty * l.unitPrice);
        const discount = Math.round(lineSubtotal * l.discountPct / 100);
        return sum + lineSubtotal - discount;
      }, 0);

      const quote = await prisma.salesQuote.create({
        data: {
          companyId,
          branchId: branchId ?? '',
          customerId: body.customerId,
          quoteNumber,
          validUntil: body.validUntil ? new Date(body.validUntil) : undefined,
          currencyCode: body.currencyCode,
          subtotal,
          discountAmount: body.discountAmount,
          taxAmount: body.taxAmount,
          totalAmount: subtotal - body.discountAmount + body.taxAmount,
          terms: body.terms,
          notes: body.notes,
          createdBy: sub,
          updatedBy: sub,
          lines: {
            create: body.lines.map((l, i) => {
              const lineSubtotal = Math.round(l.qty * l.unitPrice);
              const discount = Math.round(lineSubtotal * l.discountPct / 100);
              return {
                lineNumber: i + 1,
                productId: l.productId,
                description: l.description,
                uom: l.uom,
                qty: l.qty,
                unitPrice: l.unitPrice,
                discountPct: l.discountPct,
                lineTotal: lineSubtotal - discount,
                thickness: l.thickness,
                width: l.width,
                length: l.length,
                notes: l.notes,
              };
            }),
          },
        },
        include: { lines: true, customer: true },
      });
      return reply.status(201).send(quote);
    } catch (err) { return handleError(reply, err); }
  });

  // Convert quote to sales order
  fastify.post('/quotes/:id/convert', { preHandler: [authenticate, requirePermission('sales', 'create')] }, async (request, reply) => {
    try {
      const { companyId, branchId, sub } = request.user as { companyId: string; branchId: string; sub: string };
      const { id } = request.params as { id: string };

      const quote = await prisma.salesQuote.findFirst({
        where: { id, companyId, deletedAt: null },
        include: { lines: true },
      });
      if (!quote) throw new NotFoundError('SalesQuote', id);
      if (quote.status !== 'ACCEPTED' && quote.status !== 'DRAFT') {
        throw new ValidationError(`Cannot convert quote in status '${quote.status}'`);
      }

      const count = await prisma.salesOrder.count({ where: { companyId } });
      const orderNumber = `SO-${String(count + 1).padStart(6, '0')}`;

      const so = await prisma.$transaction(async (tx) => {
        const salesOrder = await tx.salesOrder.create({
          data: {
            companyId,
            branchId: branchId ?? '',
            customerId: quote.customerId,
            orderNumber,
            currencyCode: quote.currencyCode,
            subtotal: quote.subtotal,
            discountAmount: quote.discountAmount,
            taxAmount: quote.taxAmount,
            totalAmount: quote.totalAmount,
            terms: quote.terms,
            notes: quote.notes,
            createdBy: sub,
            updatedBy: sub,
            lines: {
              create: quote.lines.map((l) => ({
                lineNumber: l.lineNumber,
                productId: l.productId,
                description: l.description,
                uom: l.uom,
                qtyOrdered: l.qty,
                unitPrice: l.unitPrice,
                discountPct: l.discountPct,
                lineTotal: l.lineTotal,
                thickness: l.thickness,
                width: l.width,
                length: l.length,
                notes: l.notes,
              })),
            },
          },
          include: { lines: true },
        });
        await tx.salesQuote.update({
          where: { id },
          data: { status: 'CONVERTED', convertedToSOId: salesOrder.id, updatedBy: sub },
        });
        return salesOrder;
      });

      return reply.status(201).send(so);
    } catch (err) { return handleError(reply, err); }
  });

  // ── Sales Orders ────────────────────────────────────────────────────────────

  fastify.get('/orders', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const { companyId } = request.user as { companyId: string };
      const { skip, take, page, limit } = parsePagination(request.query as { page?: number; limit?: number });
      const { status, customerId } = request.query as { status?: string; customerId?: string };
      const where = {
        companyId, deletedAt: null,
        ...(status && { status: status as 'DRAFT' }),
        ...(customerId && { customerId }),
      };
      const [data, total] = await Promise.all([
        prisma.salesOrder.findMany({
          where, skip, take, orderBy: { createdAt: 'desc' },
          include: {
            customer: { select: { id: true, name: true, code: true } },
            _count: { select: { lines: true } },
          },
        }),
        prisma.salesOrder.count({ where }),
      ]);
      return paginatedResponse(data, total, page, limit);
    } catch (err) { return handleError(reply, err); }
  });

  fastify.get('/orders/:id', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const { companyId } = request.user as { companyId: string };
      const { id } = request.params as { id: string };
      const so = await prisma.salesOrder.findFirst({
        where: { id, companyId, deletedAt: null },
        include: {
          customer: true,
          lines: { include: { product: { select: { id: true, code: true, description: true, uom: true } } } },
          workOrders: { select: { id: true, workOrderNumber: true, status: true } },
          invoices: { select: { id: true, invoiceNumber: true, status: true, totalAmount: true, balanceDue: true } },
        },
      });
      if (!so) throw new NotFoundError('SalesOrder', id);
      return so;
    } catch (err) { return handleError(reply, err); }
  });

  fastify.post('/orders', { preHandler: [authenticate, requirePermission('sales', 'create')] }, async (request, reply) => {
    try {
      const { companyId, branchId, sub } = request.user as { companyId: string; branchId: string; sub: string };
      const body = z.object({
        customerId: z.string().uuid(),
        requiredDate: z.string().datetime().optional(),
        currencyCode: z.string().default('USD'),
        customerPoNumber: z.string().optional(),
        discountAmount: z.number().int().min(0).default(0),
        taxAmount: z.number().int().min(0).default(0),
        freightAmount: z.number().int().min(0).default(0),
        shippingAddress: z.record(z.unknown()).optional(),
        terms: z.string().optional(),
        notes: z.string().optional(),
        lines: z.array(quoteLineSchema).min(1),
      }).parse(request.body);

      const customer = await prisma.customer.findFirst({ where: { id: body.customerId, companyId } });
      if (!customer) throw new NotFoundError('Customer', body.customerId);
      if (customer.creditHold) throw new ValidationError('Customer is on credit hold');

      const count = await prisma.salesOrder.count({ where: { companyId } });
      const orderNumber = `SO-${String(count + 1).padStart(6, '0')}`;

      const subtotal = body.lines.reduce((sum, l) => {
        const ls = Math.round(l.qty * l.unitPrice);
        return sum + ls - Math.round(ls * l.discountPct / 100);
      }, 0);

      const so = await prisma.salesOrder.create({
        data: {
          companyId,
          branchId: branchId ?? '',
          customerId: body.customerId,
          orderNumber,
          requiredDate: body.requiredDate ? new Date(body.requiredDate) : undefined,
          currencyCode: body.currencyCode,
          customerPoNumber: body.customerPoNumber,
          subtotal,
          discountAmount: body.discountAmount,
          taxAmount: body.taxAmount,
          freightAmount: body.freightAmount,
          totalAmount: subtotal - body.discountAmount + body.taxAmount + body.freightAmount,
          shippingAddress: body.shippingAddress,
          terms: body.terms,
          notes: body.notes,
          createdBy: sub,
          updatedBy: sub,
          lines: {
            create: body.lines.map((l, i) => {
              const ls = Math.round(l.qty * l.unitPrice);
              return {
                lineNumber: i + 1,
                productId: l.productId,
                description: l.description,
                uom: l.uom,
                qtyOrdered: l.qty,
                unitPrice: l.unitPrice,
                discountPct: l.discountPct,
                lineTotal: ls - Math.round(ls * l.discountPct / 100),
                thickness: l.thickness, width: l.width, length: l.length, notes: l.notes,
              };
            }),
          },
        },
        include: { lines: true, customer: true },
      });
      await writeAuditLog(request, 'CREATE', 'SalesOrder', so.id, null, { orderNumber });
      return reply.status(201).send(so);
    } catch (err) { return handleError(reply, err); }
  });

  fastify.patch('/orders/:id/confirm', { preHandler: [authenticate, requirePermission('sales', 'edit')] }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const so = await prisma.salesOrder.update({ where: { id }, data: { status: 'CONFIRMED', updatedBy: (request.user as { sub: string }).sub } });
      return so;
    } catch (err) { return handleError(reply, err); }
  });

  fastify.patch('/orders/:id/cancel', { preHandler: [authenticate, requirePermission('sales', 'edit')] }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const so = await prisma.salesOrder.update({ where: { id }, data: { status: 'CANCELLED', updatedBy: (request.user as { sub: string }).sub } });
      return so;
    } catch (err) { return handleError(reply, err); }
  });

  // ── Pricing Rules ───────────────────────────────────────────────────────────

  fastify.get('/pricing-rules', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const { companyId } = request.user as { companyId: string };
      return await prisma.pricingRule.findMany({ where: { companyId, deletedAt: null, isActive: true }, orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }] });
    } catch (err) { return handleError(reply, err); }
  });

  fastify.post('/pricing-rules', { preHandler: [authenticate, requirePermission('sales', 'create')] }, async (request, reply) => {
    try {
      const { companyId, sub } = request.user as { companyId: string; sub: string };
      const body = z.object({
        name: z.string().min(1),
        priority: z.number().int().default(0),
        ruleType: z.enum(['CONTRACT', 'CUSTOMER', 'CUSTOMER_GROUP', 'CATEGORY', 'PRODUCT', 'QUANTITY_BREAK', 'DATE_RANGE']),
        priceType: z.enum(['FIXED', 'DISCOUNT_PCT', 'MARKUP_PCT']).default('FIXED'),
        customerId: z.string().uuid().optional(),
        customerGroupId: z.string().uuid().optional(),
        productId: z.string().uuid().optional(),
        categoryId: z.string().uuid().optional(),
        minQty: z.number().min(0).optional(),
        maxQty: z.number().min(0).optional(),
        price: z.number().int().min(0).optional(),
        discountPct: z.number().min(0).max(100).optional(),
        markupPct: z.number().min(0).optional(),
        effectiveFrom: z.string().datetime().optional(),
        effectiveTo: z.string().datetime().optional(),
      }).parse(request.body);
      const rule = await prisma.pricingRule.create({
        data: { companyId, ...body, effectiveFrom: body.effectiveFrom ? new Date(body.effectiveFrom) : undefined, effectiveTo: body.effectiveTo ? new Date(body.effectiveTo) : undefined, createdBy: sub, updatedBy: sub },
      });
      return reply.status(201).send(rule);
    } catch (err) { return handleError(reply, err); }
  });
};
