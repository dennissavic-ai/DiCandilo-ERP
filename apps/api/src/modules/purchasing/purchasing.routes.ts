import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../config/database';
import { authenticate, requirePermission } from '../../middleware/auth.middleware';
import { writeAuditLog } from '../../middleware/audit.middleware';
import { handleError, NotFoundError, ConflictError } from '../../utils/errors';
import { parsePagination, paginatedResponse } from '../../utils/pagination';

export const purchasingRoutes: FastifyPluginAsync = async (fastify) => {

  // ── Suppliers ───────────────────────────────────────────────────────────────

  fastify.get('/suppliers', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const { companyId } = request.user as { companyId: string };
      const { skip, take, page, limit } = parsePagination(request.query as { page?: number; limit?: number });
      const { search } = request.query as { search?: string };
      const where = {
        companyId, deletedAt: null, isActive: true,
        ...(search && { OR: [
          { name: { contains: search, mode: 'insensitive' as const } },
          { code: { contains: search, mode: 'insensitive' as const } },
        ]}),
      };
      const [data, total] = await Promise.all([
        prisma.supplier.findMany({ where, skip, take, orderBy: { name: 'asc' } }),
        prisma.supplier.count({ where }),
      ]);
      return paginatedResponse(data, total, page, limit);
    } catch (err) { return handleError(reply, err); }
  });

  fastify.get('/suppliers/:id', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const { companyId } = request.user as { companyId: string };
      const { id } = request.params as { id: string };
      const s = await prisma.supplier.findFirst({ where: { id, companyId, deletedAt: null } });
      if (!s) throw new NotFoundError('Supplier', id);
      return s;
    } catch (err) { return handleError(reply, err); }
  });

  fastify.post('/suppliers', { preHandler: [authenticate, requirePermission('purchasing', 'create')] }, async (request, reply) => {
    try {
      const { companyId, sub } = request.user as { companyId: string; sub: string };
      const body = z.object({
        code: z.string().min(1),
        name: z.string().min(1),
        legalName: z.string().optional(),
        taxId: z.string().optional(),
        currencyCode: z.string().default('USD'),
        paymentTerms: z.number().int().min(0).default(30),
        billingAddress: z.record(z.unknown()).optional(),
        contacts: z.array(z.record(z.unknown())).optional(),
        notes: z.string().optional(),
      }).parse(request.body);
      const existing = await prisma.supplier.findFirst({ where: { companyId, code: body.code, deletedAt: null } });
      if (existing) throw new ConflictError(`Supplier code '${body.code}' already exists`);
      const supplier = await prisma.supplier.create({ data: { companyId, ...body, createdBy: sub, updatedBy: sub } });
      return reply.status(201).send(supplier);
    } catch (err) { return handleError(reply, err); }
  });

  fastify.put('/suppliers/:id', { preHandler: [authenticate, requirePermission('purchasing', 'edit')] }, async (request, reply) => {
    try {
      const { companyId, sub } = request.user as { companyId: string; sub: string };
      const { id } = request.params as { id: string };
      const s = await prisma.supplier.findFirst({ where: { id, companyId, deletedAt: null } });
      if (!s) throw new NotFoundError('Supplier', id);
      const updated = await prisma.supplier.update({ where: { id }, data: { ...(request.body as object), updatedBy: sub } });
      return updated;
    } catch (err) { return handleError(reply, err); }
  });

  // ── Purchase Orders ─────────────────────────────────────────────────────────

  fastify.get('/orders', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const { companyId } = request.user as { companyId: string };
      const { skip, take, page, limit } = parsePagination(request.query as { page?: number; limit?: number });
      const { status, supplierId } = request.query as { status?: string; supplierId?: string };
      const where = {
        companyId, deletedAt: null,
        ...(status && { status: status as 'DRAFT' }),
        ...(supplierId && { supplierId }),
      };
      const [data, total] = await Promise.all([
        prisma.purchaseOrder.findMany({
          where, skip, take, orderBy: { createdAt: 'desc' },
          include: {
            supplier: { select: { id: true, name: true, code: true } },
            _count: { select: { lines: true } },
          },
        }),
        prisma.purchaseOrder.count({ where }),
      ]);
      return paginatedResponse(data, total, page, limit);
    } catch (err) { return handleError(reply, err); }
  });

  fastify.get('/orders/:id', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const { companyId } = request.user as { companyId: string };
      const { id } = request.params as { id: string };
      const po = await prisma.purchaseOrder.findFirst({
        where: { id, companyId, deletedAt: null },
        include: {
          supplier: true,
          lines: { include: { product: { select: { id: true, code: true, description: true, uom: true } } } },
          receipts: { include: { lines: true } },
        },
      });
      if (!po) throw new NotFoundError('PurchaseOrder', id);
      return po;
    } catch (err) { return handleError(reply, err); }
  });

  const poLineSchema = z.object({
    productId: z.string().uuid(),
    description: z.string().optional(),
    uom: z.string(),
    qtyOrdered: z.number().positive(),
    unitPrice: z.number().int().min(0),
    expectedDate: z.string().datetime().optional(),
    notes: z.string().optional(),
  });

  fastify.post('/orders', { preHandler: [authenticate, requirePermission('purchasing', 'create')] }, async (request, reply) => {
    try {
      const { companyId, branchId, sub } = request.user as { companyId: string; branchId: string; sub: string };
      const body = z.object({
        supplierId: z.string().uuid(),
        orderDate: z.string().datetime().optional(),
        expectedDate: z.string().datetime().optional(),
        currencyCode: z.string().default('USD'),
        freightCost: z.number().int().min(0).default(0),
        dutyCost: z.number().int().min(0).default(0),
        otherCosts: z.number().int().min(0).default(0),
        notes: z.string().optional(),
        terms: z.string().optional(),
        lines: z.array(poLineSchema).min(1),
      }).parse(request.body);

      // Generate PO number
      const count = await prisma.purchaseOrder.count({ where: { companyId } });
      const poNumber = `PO-${String(count + 1).padStart(6, '0')}`;

      const subtotal = body.lines.reduce((sum, l) => sum + Math.round(l.qtyOrdered * l.unitPrice), 0);
      const totalCost = subtotal + body.freightCost + body.dutyCost + body.otherCosts;

      const po = await prisma.purchaseOrder.create({
        data: {
          companyId,
          branchId: branchId ?? '',
          supplierId: body.supplierId,
          poNumber,
          orderDate: body.orderDate ? new Date(body.orderDate) : undefined,
          expectedDate: body.expectedDate ? new Date(body.expectedDate) : undefined,
          currencyCode: body.currencyCode,
          freightCost: body.freightCost,
          dutyCost: body.dutyCost,
          otherCosts: body.otherCosts,
          subtotal,
          totalCost,
          notes: body.notes,
          terms: body.terms,
          createdBy: sub,
          updatedBy: sub,
          lines: {
            create: body.lines.map((l, i) => ({
              lineNumber: i + 1,
              productId: l.productId,
              description: l.description,
              uom: l.uom,
              qtyOrdered: l.qtyOrdered,
              unitPrice: l.unitPrice,
              lineTotal: Math.round(l.qtyOrdered * l.unitPrice),
              expectedDate: l.expectedDate ? new Date(l.expectedDate) : undefined,
              notes: l.notes,
            })),
          },
        },
        include: { lines: true, supplier: true },
      });
      await writeAuditLog(request, 'CREATE', 'PurchaseOrder', po.id, null, { poNumber });
      return reply.status(201).send(po);
    } catch (err) { return handleError(reply, err); }
  });

  // Submit / approve PO
  fastify.patch('/orders/:id/submit', { preHandler: [authenticate, requirePermission('purchasing', 'edit')] }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const po = await prisma.purchaseOrder.update({
        where: { id },
        data: { status: 'SUBMITTED', updatedBy: (request.user as { sub: string }).sub },
      });
      return po;
    } catch (err) { return handleError(reply, err); }
  });

  fastify.patch('/orders/:id/approve', { preHandler: [authenticate, requirePermission('purchasing', 'approve')] }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const po = await prisma.purchaseOrder.update({
        where: { id },
        data: {
          status: 'APPROVED',
          approvedBy: (request.user as { sub: string }).sub,
          approvedAt: new Date(),
          updatedBy: (request.user as { sub: string }).sub,
        },
      });
      return po;
    } catch (err) { return handleError(reply, err); }
  });

  // PO Receipt
  fastify.post('/orders/:id/receipts', { preHandler: [authenticate, requirePermission('purchasing', 'create')] }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const { sub } = request.user as { sub: string };
      const body = z.object({
        lines: z.array(z.object({
          purchaseOrderLineId: z.string().uuid(),
          qtyReceived: z.number().positive(),
          locationId: z.string().uuid().optional(),
          heatNumber: z.string().optional(),
          certNumber: z.string().optional(),
        })),
        notes: z.string().optional(),
      }).parse(request.body);

      const count = await prisma.pOReceipt.count({ where: { purchaseOrderId: id } });
      const receiptNumber = `REC-${id.slice(0, 8)}-${count + 1}`;

      const receipt = await prisma.pOReceipt.create({
        data: {
          purchaseOrderId: id,
          receiptNumber,
          receivedBy: sub,
          notes: body.notes,
          createdBy: sub,
          lines: {
            create: body.lines.map((l) => ({
              purchaseOrderLineId: l.purchaseOrderLineId,
              qtyReceived: l.qtyReceived,
              qtyAccepted: l.qtyReceived,
              heatNumber: l.heatNumber,
              certNumber: l.certNumber,
              locationId: l.locationId,
            })),
          },
        },
        include: { lines: true },
      });
      return reply.status(201).send(receipt);
    } catch (err) { return handleError(reply, err); }
  });
};
