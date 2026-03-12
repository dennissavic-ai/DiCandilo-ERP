import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../config/database';
import { authenticate } from '../../middleware/auth.middleware';
import { writeAuditLog } from '../../middleware/audit.middleware';
import { handleError, NotFoundError } from '../../utils/errors';
import { parsePagination, paginatedResponse } from '../../utils/pagination';

export const taskRoutes: FastifyPluginAsync = async (fastify) => {

  fastify.get('/', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const { companyId, sub } = request.user as { companyId: string; sub: string };
      const { skip, take, page, limit } = parsePagination(request.query as { page?: number; limit?: number });
      const { status, assigneeId, mine } = request.query as { status?: string; assigneeId?: string; mine?: string };
      const where = {
        companyId, deletedAt: null,
        ...(status && { status: status as 'OPEN' }),
        ...(mine === 'true' ? { assigneeId: sub } : assigneeId ? { assigneeId } : {}),
      };
      const [data, total] = await Promise.all([
        prisma.task.findMany({
          where, skip, take, orderBy: [{ priority: 'desc' }, { dueDate: 'asc' }],
          include: {
            assignee: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } },
            creator: { select: { id: true, firstName: true, lastName: true } },
            _count: { select: { comments: true } },
          },
        }),
        prisma.task.count({ where }),
      ]);
      return paginatedResponse(data, total, page, limit);
    } catch (err) { return handleError(reply, err); }
  });

  fastify.get('/:id', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const task = await prisma.task.findFirst({
        where: { id, deletedAt: null },
        include: {
          assignee: { select: { id: true, firstName: true, lastName: true } },
          creator: { select: { id: true, firstName: true, lastName: true } },
          comments: { orderBy: { createdAt: 'asc' }, include: { task: false } },
        },
      });
      if (!task) throw new NotFoundError('Task', id);
      return task;
    } catch (err) { return handleError(reply, err); }
  });

  fastify.post('/', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const { companyId, sub } = request.user as { companyId: string; sub: string };
      const body = z.object({
        title: z.string().min(1),
        description: z.string().optional(),
        status: z.enum(['OPEN', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED']).default('OPEN'),
        priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
        assigneeId: z.string().uuid().optional(),
        dueDate: z.string().datetime().optional(),
        entityType: z.string().optional(),
        entityId: z.string().optional(),
      }).parse(request.body);
      const task = await prisma.task.create({
        data: { companyId, ...body, dueDate: body.dueDate ? new Date(body.dueDate) : undefined, createdById: sub },
        include: { assignee: { select: { id: true, firstName: true, lastName: true } } },
      });
      await writeAuditLog(request, 'CREATE', 'Task', task.id, null, { title: body.title });
      return reply.status(201).send(task);
    } catch (err) { return handleError(reply, err); }
  });

  fastify.put('/:id', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = z.object({
        title: z.string().optional(),
        description: z.string().optional(),
        status: z.enum(['OPEN', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED']).optional(),
        priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
        assigneeId: z.string().uuid().optional(),
        dueDate: z.string().datetime().optional(),
      }).parse(request.body);
      const updates: Record<string, unknown> = { ...body };
      if (body.dueDate) updates.dueDate = new Date(body.dueDate);
      if (body.status === 'DONE') updates.completedAt = new Date();
      const task = await prisma.task.update({ where: { id }, data: updates });
      await writeAuditLog(request, 'UPDATE', 'Task', id, null, body);
      return task;
    } catch (err) { return handleError(reply, err); }
  });

  fastify.delete('/:id', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      await prisma.task.update({ where: { id }, data: { deletedAt: new Date() } });
      await writeAuditLog(request, 'DELETE', 'Task', id, null, null);
      return reply.status(204).send();
    } catch (err) { return handleError(reply, err); }
  });

  fastify.post('/:id/comments', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const { sub } = request.user as { sub: string };
      const { body } = z.object({ body: z.string().min(1) }).parse(request.body);
      const comment = await prisma.taskComment.create({ data: { taskId: id, userId: sub, body } });
      return reply.status(201).send(comment);
    } catch (err) { return handleError(reply, err); }
  });
};
