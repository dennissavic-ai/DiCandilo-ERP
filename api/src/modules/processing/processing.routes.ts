import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../config/database';
import { authenticate, requirePermission } from '../../middleware/auth.middleware';
import { handleError, NotFoundError } from '../../utils/errors';
import { parsePagination, paginatedResponse } from '../../utils/pagination';

export const processingRoutes: FastifyPluginAsync = async (fastify) => {

  // ── Work Centers ────────────────────────────────────────────────────────────

  fastify.get('/work-centers', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const { companyId } = request.user as { companyId: string };
      return await prisma.workCenter.findMany({
        where: { companyId, deletedAt: null, isActive: true },
        orderBy: { code: 'asc' },
      });
    } catch (err) { return handleError(reply, err); }
  });

  fastify.post('/work-centers', { preHandler: [authenticate, requirePermission('processing', 'create')] }, async (request, reply) => {
    try {
      const { companyId, branchId } = request.user as { companyId: string; branchId: string };
      const body = z.object({
        code: z.string().min(1),
        name: z.string().min(1),
        type: z.string().min(1),
        capacity: z.number().optional(),
        capacityUom: z.string().optional(),
      }).parse(request.body);
      const wc = await prisma.workCenter.create({ data: { companyId, branchId, ...body } });
      return reply.status(201).send(wc);
    } catch (err) { return handleError(reply, err); }
  });

  // ── Work Orders ─────────────────────────────────────────────────────────────

  fastify.get('/work-orders', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const { companyId } = request.user as { companyId: string };
      const { skip, take, page, limit } = parsePagination(request.query as { page?: number; limit?: number });
      const { status } = request.query as { status?: string };
      const where = { companyId, deletedAt: null, ...(status && { status: status as 'DRAFT' }) };
      const [data, total] = await Promise.all([
        prisma.workOrder.findMany({
          where, skip, take, orderBy: [{ priority: 'desc' }, { scheduledDate: 'asc' }],
          include: {
            salesOrder: { select: { orderNumber: true, customer: { select: { name: true } } } },
            _count: { select: { lines: true } },
          },
        }),
        prisma.workOrder.count({ where }),
      ]);
      return paginatedResponse(data, total, page, limit);
    } catch (err) { return handleError(reply, err); }
  });

  fastify.get('/work-orders/:id', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const { companyId } = request.user as { companyId: string };
      const { id } = request.params as { id: string };
      const wo = await prisma.workOrder.findFirst({
        where: { id, companyId, deletedAt: null },
        include: {
          lines: { include: { product: true, workCenter: true } },
          salesOrder: { select: { orderNumber: true } },
        },
      });
      if (!wo) throw new NotFoundError('WorkOrder', id);
      return wo;
    } catch (err) { return handleError(reply, err); }
  });

  fastify.post('/work-orders', { preHandler: [authenticate, requirePermission('processing', 'create')] }, async (request, reply) => {
    try {
      const { companyId, branchId, sub } = request.user as { companyId: string; branchId: string; sub: string };
      const body = z.object({
        salesOrderId: z.string().uuid().optional(),
        scheduledDate: z.string().datetime().optional(),
        priority: z.number().int().min(1).max(10).default(5),
        notes: z.string().optional(),
        isOutsourced: z.boolean().default(false),
        outsourceSupplierId: z.string().uuid().optional(),
        lines: z.array(z.object({
          salesOrderLineId: z.string().uuid().optional(),
          lineNumber: z.number().int().positive(),
          productId: z.string().uuid().optional(),
          workCenterId: z.string().uuid().optional(),
          operation: z.string().min(1),
          description: z.string().optional(),
          qtyRequired: z.number().positive(),
          estimatedMinutes: z.number().int().positive().optional(),
          cutLength: z.number().int().positive().optional(),
          notes: z.string().optional(),
        })).min(1),
      }).parse(request.body);

      const count = await prisma.workOrder.count({ where: { companyId } });
      const workOrderNumber = `WO-${String(count + 1).padStart(6, '0')}`;

      const wo = await prisma.workOrder.create({
        data: {
          companyId,
          branchId: branchId ?? '',
          workOrderNumber,
          salesOrderId: body.salesOrderId,
          scheduledDate: body.scheduledDate ? new Date(body.scheduledDate) : undefined,
          priority: body.priority,
          notes: body.notes,
          isOutsourced: body.isOutsourced,
          outsourceSupplierId: body.outsourceSupplierId,
          createdBy: sub,
          updatedBy: sub,
          lines: { create: body.lines },
        },
        include: { lines: true },
      });
      return reply.status(201).send(wo);
    } catch (err) { return handleError(reply, err); }
  });

  // Update work order status
  fastify.patch('/work-orders/:id/status', { preHandler: [authenticate, requirePermission('processing', 'edit')] }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const { sub } = request.user as { sub: string };
      const { status } = z.object({ status: z.enum(['DRAFT', 'SCHEDULED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED']) }).parse(request.body);
      const updates: Record<string, unknown> = { status, updatedBy: sub };
      if (status === 'IN_PROGRESS') updates.startDate = new Date();
      if (status === 'COMPLETED') updates.completedDate = new Date();
      const wo = await prisma.workOrder.update({ where: { id }, data: updates });
      return wo;
    } catch (err) { return handleError(reply, err); }
  });

  // Record completion on a work order line
  fastify.patch('/work-orders/:woId/lines/:lineId/complete', { preHandler: [authenticate, requirePermission('processing', 'edit')] }, async (request, reply) => {
    try {
      const { woId, lineId } = request.params as { woId: string; lineId: string };
      const body = z.object({
        qtyCompleted: z.number().min(0),
        qtyScrap: z.number().min(0).default(0),
        actualMinutes: z.number().int().min(0).optional(),
      }).parse(request.body);
      const line = await prisma.workOrderLine.update({ where: { id: lineId }, data: body });
      return line;
    } catch (err) { return handleError(reply, err); }
  });

  // ── Scheduling board ────────────────────────────────────────────────────────

  fastify.get('/schedule', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const { companyId } = request.user as { companyId: string };
      const { from, to } = z.object({
        from: z.string().datetime().optional(),
        to: z.string().datetime().optional(),
      }).parse(request.query);

      const fromDate = from ? new Date(from) : new Date();
      const toDate = to ? new Date(to) : new Date(fromDate.getTime() + 7 * 86400000);

      const workOrders = await prisma.workOrder.findMany({
        where: {
          companyId,
          deletedAt: null,
          status: { notIn: ['COMPLETED', 'CANCELLED'] },
          scheduledDate: { gte: fromDate, lte: toDate },
        },
        include: {
          lines: { include: { workCenter: true } },
          salesOrder: { select: { orderNumber: true, customer: { select: { name: true } } } },
        },
        orderBy: [{ priority: 'desc' }, { scheduledDate: 'asc' }],
      });

      return workOrders;
    } catch (err) { return handleError(reply, err); }
  });
};
