import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../config/database';
import { authenticate } from '../../middleware/auth.middleware';

const planning: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', authenticate);

  // ── GET /planning/work-orders — list work orders for planning ─────────────────
  fastify.get('/work-orders', async (request) => {
    const user = (request as any).user;
    const workOrders = await (prisma as any).workOrder.findMany({
      where: { companyId: user.companyId, deletedAt: null },
      include: {
        salesOrder: { select: { orderNumber: true, customer: { select: { name: true } } } },
        jobPlan: { select: { id: true, status: true, scheduleBlocks: { select: { id: true } } } },
        lines: { select: { id: true, operation: true, description: true, estimatedMinutes: true, workCenterId: true, workCenter: { select: { id: true, code: true, name: true } } }, orderBy: { lineNumber: 'asc' } },
      },
      orderBy: [{ priority: 'asc' }, { scheduledDate: 'asc' }, { createdAt: 'desc' }],
    });
    return workOrders;
  });

  // ── GET /planning/work-centers — list available work centers ──────────────────
  fastify.get('/work-centers', async (request) => {
    const user = (request as any).user;
    const workCenters = await (prisma as any).workCenter.findMany({
      where: { companyId: user.companyId, isActive: true, deletedAt: null },
      orderBy: { name: 'asc' },
    });
    return workCenters;
  });

  // ── GET /planning/plans/:workOrderId — get or create plan for a work order ────
  fastify.get('/plans/:workOrderId', async (request, reply) => {
    const { workOrderId } = request.params as { workOrderId: string };
    const user = (request as any).user;

    const workOrder = await (prisma as any).workOrder.findFirst({
      where: { id: workOrderId, companyId: user.companyId },
      include: {
        salesOrder: {
          select: {
            orderNumber: true,
            customer: { select: { name: true } },
            lines: { select: { description: true, qtyOrdered: true, uom: true } },
          },
        },
        lines: { include: { workCenter: true } },
      },
    });
    if (!workOrder) return reply.status(404).send({ error: 'Work order not found' });

    let plan = await (prisma as any).jobPlan.findUnique({
      where: { workOrderId },
      include: {
        roles: { orderBy: { createdAt: 'asc' } },
        equipment: { include: { workCenter: true }, orderBy: { sequenceOrder: 'asc' } },
        tasks: { orderBy: { sortOrder: 'asc' } },
        scheduleBlocks: { include: { workCenter: true }, orderBy: { startAt: 'asc' } },
      },
    });

    if (!plan) {
      plan = await (prisma as any).jobPlan.create({
        data: {
          companyId: user.companyId,
          workOrderId,
          status: 'DRAFT',
          createdBy: user.userId,
          updatedAt: new Date(),
        },
        include: {
          roles: true,
          equipment: { include: { workCenter: true } },
          tasks: { orderBy: { sortOrder: 'asc' } },
          scheduleBlocks: { include: { workCenter: true } },
        },
      });
    }

    return { workOrder, plan };
  });

  // ── PUT /planning/plans/:planId/status — update plan status ──────────────────
  const statusSchema = z.object({ status: z.enum(['DRAFT', 'READY', 'SCHEDULED']) });
  fastify.put('/plans/:planId/status', async (request, reply) => {
    const { planId } = request.params as { planId: string };
    const user = (request as any).user;
    const body = statusSchema.parse(request.body);

    const plan = await (prisma as any).jobPlan.findFirst({
      where: { id: planId, companyId: user.companyId },
    });
    if (!plan) return reply.status(404).send({ error: 'Plan not found' });

    const updated = await (prisma as any).jobPlan.update({
      where: { id: planId },
      data: { status: body.status, updatedBy: user.userId, updatedAt: new Date() },
    });
    return updated;
  });

  // ── PUT /planning/plans/:planId/notes ─────────────────────────────────────────
  fastify.put('/plans/:planId/notes', async (request, reply) => {
    const { planId } = request.params as { planId: string };
    const user = (request as any).user;
    const { notes } = z.object({ notes: z.string().optional() }).parse(request.body);

    const plan = await (prisma as any).jobPlan.findFirst({
      where: { id: planId, companyId: user.companyId },
    });
    if (!plan) return reply.status(404).send({ error: 'Plan not found' });

    return (prisma as any).jobPlan.update({
      where: { id: planId },
      data: { notes: notes ?? null, updatedBy: user.userId, updatedAt: new Date() },
    });
  });

  // ── POST /planning/plans/:planId/roles ────────────────────────────────────────
  const roleSchema = z.object({
    roleName: z.string().min(1),
    estimatedHours: z.number().min(0).default(0),
    assignedUserId: z.string().optional(),
    notes: z.string().optional(),
  });
  fastify.post('/plans/:planId/roles', async (request, reply) => {
    const { planId } = request.params as { planId: string };
    const user = (request as any).user;
    const plan = await (prisma as any).jobPlan.findFirst({ where: { id: planId, companyId: user.companyId } });
    if (!plan) return reply.status(404).send({ error: 'Plan not found' });

    const data = roleSchema.parse(request.body);
    const role = await (prisma as any).jobPlanRole.create({
      data: { jobPlanId: planId, ...data, updatedAt: new Date() },
    });
    return role;
  });

  fastify.delete('/plans/:planId/roles/:roleId', async (request, reply) => {
    const { planId, roleId } = request.params as { planId: string; roleId: string };
    const user = (request as any).user;
    const plan = await (prisma as any).jobPlan.findFirst({ where: { id: planId, companyId: user.companyId } });
    if (!plan) return reply.status(404).send({ error: 'Plan not found' });
    await (prisma as any).jobPlanRole.delete({ where: { id: roleId } });
    return { ok: true };
  });

  // ── POST /planning/plans/:planId/equipment ────────────────────────────────────
  const equipSchema = z.object({
    workCenterId: z.string().uuid(),
    estimatedMinutes: z.number().int().min(0).default(0),
    sequenceOrder: z.number().int().min(0).default(0),
    notes: z.string().optional(),
  });
  fastify.post('/plans/:planId/equipment', async (request, reply) => {
    const { planId } = request.params as { planId: string };
    const user = (request as any).user;
    const plan = await (prisma as any).jobPlan.findFirst({ where: { id: planId, companyId: user.companyId } });
    if (!plan) return reply.status(404).send({ error: 'Plan not found' });

    const data = equipSchema.parse(request.body);
    const equip = await (prisma as any).jobPlanEquipment.create({
      data: { jobPlanId: planId, ...data, updatedAt: new Date() },
      include: { workCenter: true },
    });
    return equip;
  });

  fastify.delete('/plans/:planId/equipment/:equipId', async (request, reply) => {
    const { planId, equipId } = request.params as { planId: string; equipId: string };
    const user = (request as any).user;
    const plan = await (prisma as any).jobPlan.findFirst({ where: { id: planId, companyId: user.companyId } });
    if (!plan) return reply.status(404).send({ error: 'Plan not found' });
    await (prisma as any).jobPlanEquipment.delete({ where: { id: equipId } });
    return { ok: true };
  });

  // ── POST /planning/plans/:planId/tasks ────────────────────────────────────────
  const taskSchema = z.object({
    title: z.string().min(1),
    description: z.string().optional(),
    sortOrder: z.number().int().min(0).default(0),
  });
  fastify.post('/plans/:planId/tasks', async (request, reply) => {
    const { planId } = request.params as { planId: string };
    const user = (request as any).user;
    const plan = await (prisma as any).jobPlan.findFirst({ where: { id: planId, companyId: user.companyId } });
    if (!plan) return reply.status(404).send({ error: 'Plan not found' });

    const data = taskSchema.parse(request.body);
    const task = await (prisma as any).jobPlanTask.create({
      data: { jobPlanId: planId, ...data, updatedAt: new Date() },
    });
    return task;
  });

  fastify.patch('/plans/:planId/tasks/:taskId', async (request, reply) => {
    const { planId, taskId } = request.params as { planId: string; taskId: string };
    const user = (request as any).user;
    const plan = await (prisma as any).jobPlan.findFirst({ where: { id: planId, companyId: user.companyId } });
    if (!plan) return reply.status(404).send({ error: 'Plan not found' });

    const body = z.object({ isComplete: z.boolean() }).parse(request.body);
    const task = await (prisma as any).jobPlanTask.update({
      where: { id: taskId },
      data: {
        isComplete: body.isComplete,
        completedAt: body.isComplete ? new Date() : null,
        completedBy: body.isComplete ? user.userId : null,
        updatedAt: new Date(),
      },
    });
    return task;
  });

  fastify.delete('/plans/:planId/tasks/:taskId', async (request, reply) => {
    const { planId, taskId } = request.params as { planId: string; taskId: string };
    const user = (request as any).user;
    const plan = await (prisma as any).jobPlan.findFirst({ where: { id: planId, companyId: user.companyId } });
    if (!plan) return reply.status(404).send({ error: 'Plan not found' });
    await (prisma as any).jobPlanTask.delete({ where: { id: taskId } });
    return { ok: true };
  });

  // ── GET /planning/schedule — get schedule blocks for a date range ──────────────
  fastify.get('/schedule', async (request) => {
    const user = (request as any).user;
    const query = request.query as { from?: string; to?: string };
    const from = query.from ? new Date(query.from) : new Date();
    const to = query.to ? new Date(query.to) : new Date(Date.now() + 14 * 86400000);

    const blocks = await (prisma as any).scheduleBlock.findMany({
      where: {
        companyId: user.companyId,
        startAt: { gte: from },
        endAt: { lte: to },
      },
      include: {
        workCenter: true,
        jobPlan: {
          include: {
            workOrder: {
              select: {
                workOrderNumber: true, priority: true, status: true,
                salesOrder: { select: { orderNumber: true, customer: { select: { name: true } } } },
              },
            },
          },
        },
      },
      orderBy: { startAt: 'asc' },
    });
    return blocks;
  });

  // ── POST /planning/plans/:planId/schedule-blocks — add a block manually ───────
  const blockSchema = z.object({
    workCenterId: z.string().uuid(),
    startAt: z.string().datetime(),
    endAt: z.string().datetime(),
    notes: z.string().optional(),
  });
  fastify.post('/plans/:planId/schedule-blocks', async (request, reply) => {
    const { planId } = request.params as { planId: string };
    const user = (request as any).user;
    const plan = await (prisma as any).jobPlan.findFirst({ where: { id: planId, companyId: user.companyId } });
    if (!plan) return reply.status(404).send({ error: 'Plan not found' });

    const data = blockSchema.parse(request.body);
    const block = await (prisma as any).scheduleBlock.create({
      data: {
        companyId: user.companyId,
        jobPlanId: planId,
        ...data,
        startAt: new Date(data.startAt),
        endAt: new Date(data.endAt),
        updatedAt: new Date(),
      },
      include: { workCenter: true },
    });
    return block;
  });

  fastify.delete('/plans/:planId/schedule-blocks/:blockId', async (request, reply) => {
    const { planId, blockId } = request.params as { planId: string; blockId: string };
    const user = (request as any).user;
    const plan = await (prisma as any).jobPlan.findFirst({ where: { id: planId, companyId: user.companyId } });
    if (!plan) return reply.status(404).send({ error: 'Plan not found' });
    await (prisma as any).scheduleBlock.delete({ where: { id: blockId } });
    return { ok: true };
  });

  // ── POST /planning/quick-schedule — distribute all unscheduled WO actions ──
  fastify.post('/quick-schedule', async (request) => {
    const user = (request as any).user;

    // Get all active work orders with lines
    const workOrders = await (prisma as any).workOrder.findMany({
      where: {
        companyId: user.companyId,
        deletedAt: null,
        status: { notIn: ['COMPLETED', 'CANCELLED'] },
      },
      include: {
        lines: { include: { workCenter: true }, orderBy: { lineNumber: 'asc' } },
        jobPlan: { include: { scheduleBlocks: true } },
      },
      orderBy: [{ priority: 'asc' }, { scheduledDate: 'asc' }],
    });

    // Get all active work centres
    const workCenters = await (prisma as any).workCenter.findMany({
      where: { companyId: user.companyId, isActive: true, deletedAt: null },
      orderBy: { code: 'asc' },
    });

    if (workCenters.length === 0) {
      return { scheduled: 0, message: 'No active work centres found' };
    }

    // Track the next available slot per work centre: { wcId: nextAvailableDate }
    const now = new Date();
    // Start scheduling from tomorrow at 7:00 AM
    const scheduleStart = new Date(now);
    scheduleStart.setDate(scheduleStart.getDate() + 1);
    scheduleStart.setHours(7, 0, 0, 0);
    // Skip to Monday if weekend
    const dow = scheduleStart.getDay();
    if (dow === 0) scheduleStart.setDate(scheduleStart.getDate() + 1); // Sunday -> Monday
    if (dow === 6) scheduleStart.setDate(scheduleStart.getDate() + 2); // Saturday -> Monday

    const wcSlots: Record<string, Date> = {};
    for (const wc of workCenters) {
      wcSlots[wc.id] = new Date(scheduleStart);
    }

    function advanceSlot(wcId: string, durationMinutes: number) {
      const current = wcSlots[wcId];
      const end = new Date(current.getTime() + durationMinutes * 60000);
      // If past 17:00 (5 PM), move to next working day at 7:00
      if (end.getHours() >= 17 || (end.getHours() === 17 && end.getMinutes() > 0)) {
        const nextDay = new Date(current);
        nextDay.setDate(nextDay.getDate() + 1);
        nextDay.setHours(7, 0, 0, 0);
        // Skip weekends
        const d = nextDay.getDay();
        if (d === 0) nextDay.setDate(nextDay.getDate() + 1);
        if (d === 6) nextDay.setDate(nextDay.getDate() + 2);
        wcSlots[wcId] = nextDay;
      } else {
        wcSlots[wcId] = end;
      }
    }

    let scheduledCount = 0;

    for (const wo of workOrders) {
      // Skip WOs that already have schedule blocks
      if (wo.jobPlan?.scheduleBlocks?.length > 0) continue;

      // Ensure a plan exists
      let plan = wo.jobPlan;
      if (!plan) {
        plan = await (prisma as any).jobPlan.create({
          data: {
            companyId: user.companyId,
            workOrderId: wo.id,
            status: 'DRAFT',
            createdBy: user.userId,
            updatedAt: new Date(),
          },
        });
      }

      for (const line of wo.lines) {
        const durationMins = line.estimatedMinutes ?? 60;
        // Use the line's assigned work centre, or round-robin across all
        const wcId = line.workCenterId ?? workCenters[scheduledCount % workCenters.length].id;

        // Initialize slot if this WC hasn't been seen
        if (!wcSlots[wcId]) wcSlots[wcId] = new Date(scheduleStart);

        const startAt = new Date(wcSlots[wcId]);
        const endAt = new Date(startAt.getTime() + durationMins * 60000);

        await (prisma as any).scheduleBlock.create({
          data: {
            companyId: user.companyId,
            jobPlanId: plan.id,
            workCenterId: wcId,
            startAt,
            endAt,
            notes: `${line.operation} — ${wo.workOrderNumber}`,
            updatedAt: new Date(),
          },
        });

        advanceSlot(wcId, durationMins);
        scheduledCount++;
      }
    }

    return { scheduled: scheduledCount, message: `Scheduled ${scheduledCount} actions across ${workCenters.length} work centres` };
  });

  // ── POST /planning/clear-schedule — remove all schedule blocks ─────────────
  fastify.post('/clear-schedule', async (request) => {
    const user = (request as any).user;
    const result = await (prisma as any).scheduleBlock.deleteMany({
      where: { companyId: user.companyId },
    });
    return { deleted: result.count };
  });
};

export default planning;
