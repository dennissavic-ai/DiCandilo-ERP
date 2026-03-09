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

  // ── Kanban board ────────────────────────────────────────────────────────────

  fastify.get('/kanban', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const { companyId } = request.user as { companyId: string };

      const workOrders = await prisma.workOrder.findMany({
        where: { companyId, deletedAt: null },
        include: {
          salesOrder: {
            select: {
              orderNumber: true,
              totalAmount: true,
              customer: { select: { name: true } },
            },
          },
          lines: {
            select: {
              id: true, operation: true, qtyRequired: true, qtyCompleted: true,
              estimatedMinutes: true, actualMinutes: true,
              workCenter: { select: { id: true, code: true, name: true } },
            },
          },
          _count: { select: { timeEntries: true } },
        },
        orderBy: [{ priority: 'desc' }, { scheduledDate: 'asc' }],
      });

      const STATUS_ORDER = ['DRAFT', 'SCHEDULED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED'];
      const grouped: Record<string, unknown[]> = {};
      for (const s of STATUS_ORDER) grouped[s] = [];
      for (const wo of workOrders) {
        if (grouped[wo.status]) grouped[wo.status].push(wo);
      }

      return reply.send({ data: grouped, statusOrder: STATUS_ORDER });
    } catch (err) { return handleError(reply, err); }
  });

  // ── Processing dashboard ────────────────────────────────────────────────────

  fastify.get('/dashboard', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const { companyId } = request.user as { companyId: string };
      const now = new Date();

      const [allWOs, completedWOs, revenueInPipeline] = await Promise.all([
        prisma.workOrder.findMany({
          where: { companyId, deletedAt: null },
          select: {
            id: true, status: true, scheduledDate: true, startDate: true,
            completedDate: true, priority: true,
            salesOrder: { select: { orderNumber: true, totalAmount: true, customer: { select: { name: true } } } },
          },
        }),
        prisma.workOrder.findMany({
          where: { companyId, deletedAt: null, status: 'COMPLETED', startDate: { not: null }, completedDate: { not: null } },
          select: { startDate: true, completedDate: true },
        }),
        prisma.workOrder.aggregate({
          where: {
            companyId,
            deletedAt: null,
            status: { notIn: ['COMPLETED', 'CANCELLED'] },
            salesOrderId: { not: null },
          },
          _sum: { },
        }),
      ]);

      // avg order→dispatch (completedDate - startDate) in hours
      let avgHours: number | null = null;
      if (completedWOs.length > 0) {
        const totalMs = completedWOs.reduce((sum, wo) => {
          if (!wo.startDate || !wo.completedDate) return sum;
          return sum + (new Date(wo.completedDate).getTime() - new Date(wo.startDate).getTime());
        }, 0);
        avgHours = Math.round(totalMs / completedWOs.length / 3600000 * 10) / 10;
      }

      // Revenue in pipeline: sum salesOrder.totalAmount for active WOs
      const activeWOs = allWOs.filter((wo) => !['COMPLETED', 'CANCELLED'].includes(wo.status));
      const pipelineRevenue = activeWOs.reduce((sum, wo) => {
        return sum + Number(wo.salesOrder?.totalAmount ?? 0);
      }, 0);

      // Status counts
      const statusCounts: Record<string, number> = {};
      for (const wo of allWOs) {
        statusCounts[wo.status] = (statusCounts[wo.status] ?? 0) + 1;
      }

      // Upcoming dispatch (WOs scheduled in next 14 days, not completed)
      const twoWeeks = new Date(now.getTime() + 14 * 86400000);
      const upcoming = allWOs
        .filter((wo) => wo.scheduledDate && new Date(wo.scheduledDate) <= twoWeeks && !['COMPLETED', 'CANCELLED'].includes(wo.status))
        .sort((a, b) => new Date(a.scheduledDate!).getTime() - new Date(b.scheduledDate!).getTime())
        .slice(0, 10)
        .map((wo) => ({
          id: wo.id,
          status: wo.status,
          scheduledDate: wo.scheduledDate,
          customer: wo.salesOrder?.customer?.name,
          orderNumber: wo.salesOrder?.orderNumber,
          totalAmount: wo.salesOrder?.totalAmount,
        }));

      return reply.send({
        data: {
          totalJobs: allWOs.length,
          activeJobs: activeWOs.length,
          avgCycleHours: avgHours,
          pipelineRevenue,
          statusCounts,
          upcoming,
        },
      });
    } catch (err) { return handleError(reply, err); }
  });

  // ── Time tracking ───────────────────────────────────────────────────────────

  // GET time entries for a work order (or all recent)
  fastify.get('/time-entries', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const { companyId } = request.user as { companyId: string };
      const { workOrderId, workCenterId, limit: lim } = request.query as {
        workOrderId?: string; workCenterId?: string; limit?: string;
      };

      const entries = await (prisma as any).jobTimeEntry.findMany({
        where: {
          companyId,
          ...(workOrderId && { workOrderId }),
          ...(workCenterId && { workCenterId }),
        },
        orderBy: { scannedAt: 'desc' },
        take: Math.min(Number(lim ?? 200), 500),
        include: {
          workOrder: { select: { workOrderNumber: true } },
          workCenter: { select: { code: true, name: true } },
        },
      });

      return reply.send({ data: entries });
    } catch (err) { return handleError(reply, err); }
  });

  // POST time entry (manual or via scan)
  fastify.post('/time-entries', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const { companyId, sub } = request.user as { companyId: string; sub: string };
      const body = z.object({
        workOrderId:  z.string().uuid(),
        workCenterId: z.string().uuid().optional(),
        eventType:    z.enum(['CHECK_IN', 'CHECK_OUT']),
        scannedAt:    z.string().datetime().optional(),
        notes:        z.string().optional(),
      }).parse(request.body);

      // If CHECK_OUT, find the latest unmatched CHECK_IN for this WO+station
      let pairedCheckIn: any = null;
      if (body.eventType === 'CHECK_OUT') {
        const entries = await (prisma as any).jobTimeEntry.findMany({
          where: { companyId, workOrderId: body.workOrderId, ...(body.workCenterId && { workCenterId: body.workCenterId }), eventType: 'CHECK_IN' },
          orderBy: { scannedAt: 'desc' },
          take: 10,
        });
        // Check how many check-outs already follow this check-in
        for (const e of entries) {
          const checkOutCount = await (prisma as any).jobTimeEntry.count({
            where: {
              companyId,
              workOrderId: body.workOrderId,
              workCenterId: body.workCenterId ?? null,
              eventType: 'CHECK_OUT',
              scannedAt: { gte: e.scannedAt },
            },
          });
          if (checkOutCount === 0) { pairedCheckIn = e; break; }
        }
      }

      const entry = await (prisma as any).jobTimeEntry.create({
        data: {
          companyId,
          workOrderId: body.workOrderId,
          workCenterId: body.workCenterId,
          userId: sub,
          eventType: body.eventType,
          scannedAt: body.scannedAt ? new Date(body.scannedAt) : new Date(),
          notes: body.notes,
          createdBy: sub,
        },
        include: {
          workOrder: { select: { workOrderNumber: true } },
          workCenter: { select: { code: true, name: true } },
        },
      });

      // Auto-transition work order status on first CHECK_IN
      if (body.eventType === 'CHECK_IN') {
        const wo = await prisma.workOrder.findFirst({ where: { id: body.workOrderId, companyId } });
        if (wo && wo.status === 'SCHEDULED') {
          await prisma.workOrder.update({
            where: { id: body.workOrderId },
            data: { status: 'IN_PROGRESS', startDate: new Date(), updatedBy: sub },
          });
        }
      }

      return reply.status(201).send({ data: entry, pairedCheckIn });
    } catch (err) { return handleError(reply, err); }
  });

  // ── Barcode scan endpoint ───────────────────────────────────────────────────

  // POST /processing/scan — called when operator scans a job barcode + station barcode
  // The barcodes resolve to workOrderNumber and workCenter code respectively
  fastify.post('/scan', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const { companyId, sub } = request.user as { companyId: string; sub: string };
      const body = z.object({
        jobBarcode:     z.string().min(1),  // workOrderNumber or barcode data
        stationBarcode: z.string().optional(), // workCenter code or barcode data
        eventType:      z.enum(['CHECK_IN', 'CHECK_OUT']).default('CHECK_IN'),
      }).parse(request.body);

      // Resolve work order
      const wo = await prisma.workOrder.findFirst({
        where: {
          companyId, deletedAt: null,
          OR: [
            { workOrderNumber: body.jobBarcode },
            { id: body.jobBarcode },
          ],
        },
      });
      if (!wo) {
        return reply.status(404).send({ error: 'WORK_ORDER_NOT_FOUND', message: `No work order found for barcode: ${body.jobBarcode}` });
      }

      // Resolve work center (optional)
      let workCenter = null;
      if (body.stationBarcode) {
        workCenter = await prisma.workCenter.findFirst({
          where: {
            companyId, deletedAt: null, isActive: true,
            OR: [
              { code: body.stationBarcode },
              { id: body.stationBarcode },
            ],
          },
        });
      }

      // Create time entry
      const entry = await (prisma as any).jobTimeEntry.create({
        data: {
          companyId,
          workOrderId: wo.id,
          workCenterId: workCenter?.id ?? null,
          userId: sub,
          eventType: body.eventType,
          scannedAt: new Date(),
          createdBy: sub,
        },
        include: {
          workOrder: { select: { workOrderNumber: true } },
          workCenter: { select: { code: true, name: true } },
        },
      });

      // Auto-status transition
      if (body.eventType === 'CHECK_IN' && wo.status === 'SCHEDULED') {
        await prisma.workOrder.update({
          where: { id: wo.id },
          data: { status: 'IN_PROGRESS', startDate: new Date(), updatedBy: sub },
        });
      }
      if (body.eventType === 'CHECK_OUT' && wo.status === 'IN_PROGRESS') {
        // Check if all lines are complete to auto-close
        const lines = await prisma.workOrderLine.findMany({ where: { workOrderId: wo.id } });
        const allDone = lines.every((l) => Number(l.qtyCompleted) >= Number(l.qtyRequired));
        if (allDone && lines.length > 0) {
          await prisma.workOrder.update({
            where: { id: wo.id },
            data: { status: 'COMPLETED', completedDate: new Date(), updatedBy: sub },
          });
        }
      }

      return reply.send({
        message: `${body.eventType} recorded`,
        workOrder: { id: wo.id, workOrderNumber: wo.workOrderNumber, status: wo.status },
        workCenter: workCenter ? { id: workCenter.id, code: workCenter.code, name: workCenter.name } : null,
        entry,
      });
    } catch (err) { return handleError(reply, err); }
  });
};
