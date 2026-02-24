import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import argon2 from 'argon2';
import { prisma } from '../../config/database';
import { authenticate, requirePermission, requireAdmin } from '../../middleware/auth.middleware';
import { handleError, NotFoundError, ConflictError } from '../../utils/errors';
import { parsePagination, paginatedResponse } from '../../utils/pagination';
import { passwordSchema } from '../../utils/password';
import { AuthService } from '../auth/auth.service';

export const userRoutes: FastifyPluginAsync = async (fastify) => {
  const authService = new AuthService(fastify);

  // ── Users ───────────────────────────────────────────────────────────────────

  fastify.get('/', { preHandler: [authenticate, requirePermission('users', 'view')] }, async (request, reply) => {
    try {
      const { companyId } = request.user as { companyId: string };
      const { skip, take, page, limit } = parsePagination(request.query as { page?: number; limit?: number });
      const [data, total] = await Promise.all([
        prisma.user.findMany({
          where: { companyId, deletedAt: null },
          skip, take,
          orderBy: { firstName: 'asc' },
          select: { id: true, email: true, firstName: true, lastName: true, phone: true, isActive: true, lastLoginAt: true, role: { select: { id: true, name: true } }, branch: { select: { id: true, name: true } } },
        }),
        prisma.user.count({ where: { companyId, deletedAt: null } }),
      ]);
      return paginatedResponse(data, total, page, limit);
    } catch (err) { return handleError(reply, err); }
  });

  fastify.post('/', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    try {
      const { companyId, sub } = request.user as { companyId: string; sub: string };
      const body = z.object({
        email: z.string().email(),
        // Admin-created users must use compliant passwords (SOC2 CC6)
        password: passwordSchema,
        firstName: z.string().min(1),
        lastName: z.string().min(1),
        phone: z.string().optional(),
        roleId: z.string().uuid(),
        branchId: z.string().uuid().optional(),
        // Admin can force the new user to change password on first login
        requirePasswordChange: z.boolean().default(true),
      }).parse(request.body);
      const existing = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
      if (existing) throw new ConflictError('Email already in use');
      const passwordHash = await argon2.hash(body.password);
      const { requirePasswordChange, ...rest } = body;
      const user = await prisma.user.create({
        data: {
          companyId,
          ...rest,
          email: rest.email.toLowerCase(),
          passwordHash,
          requirePasswordChange,
          passwordChangedAt: new Date(),
          createdBy: sub,
          updatedBy: sub,
        },
        select: { id: true, email: true, firstName: true, lastName: true, requirePasswordChange: true, role: { select: { id: true, name: true } } },
      });
      return reply.status(201).send(user);
    } catch (err) { return handleError(reply, err); }
  });

  fastify.put('/:id', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    try {
      const { companyId, sub } = request.user as { companyId: string; sub: string };
      const { id } = request.params as { id: string };
      const user = await prisma.user.findFirst({ where: { id, companyId, deletedAt: null } });
      if (!user) throw new NotFoundError('User', id);
      const body = z.object({
        firstName: z.string().optional(), lastName: z.string().optional(),
        phone: z.string().optional(), roleId: z.string().uuid().optional(),
        branchId: z.string().uuid().optional(), isActive: z.boolean().optional(),
      }).parse(request.body);
      const updated = await prisma.user.update({
        where: { id }, data: { ...body, updatedBy: sub },
        select: { id: true, email: true, firstName: true, lastName: true, isActive: true },
      });
      return updated;
    } catch (err) { return handleError(reply, err); }
  });

  fastify.delete('/:id', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    try {
      const { companyId, sub } = request.user as { companyId: string; sub: string };
      const { id } = request.params as { id: string };
      if (id === sub) return reply.status(400).send({ error: 'Cannot delete your own account' });
      const user = await prisma.user.findFirst({ where: { id, companyId, deletedAt: null } });
      if (!user) throw new NotFoundError('User', id);
      await prisma.user.update({ where: { id }, data: { deletedAt: new Date(), isActive: false, updatedBy: sub } });
      return reply.status(204).send();
    } catch (err) { return handleError(reply, err); }
  });

  // ── Account unlock (SOC2 CC6 / ISO 27001 A.9.4.2) ──────────────────────────

  fastify.post('/:id/unlock', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const { sub, companyId } = request.user as { sub: string; companyId: string };
      // Ensure target user belongs to the same company
      const target = await prisma.user.findFirst({ where: { id, companyId, deletedAt: null } });
      if (!target) throw new NotFoundError('User', id);
      await authService.unlockAccount(id, sub, request.ip);
      return reply.send({ message: 'Account unlocked successfully' });
    } catch (err) { return handleError(reply, err); }
  });

  // ── Roles & Permissions ─────────────────────────────────────────────────────

  fastify.get('/roles', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      // SOC2 CC6 / OWASP API1 — Scope roles to the caller's company only
      const { companyId } = request.user as { companyId: string };
      const roles = await prisma.role.findMany({
        where: {
          deletedAt: null,
          // System roles are global; custom roles are company-scoped.
          // Return roles that have at least one user in this company OR are system roles.
          OR: [
            { isSystem: true },
            { users: { some: { companyId } } },
          ],
        },
        include: { permissions: { include: { permission: true } } },
      });
      return roles;
    } catch (err) { return handleError(reply, err); }
  });

  fastify.post('/roles', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    try {
      const body = z.object({
        name: z.string().min(1),
        description: z.string().optional(),
        permissionIds: z.array(z.string().uuid()).optional(),
      }).parse(request.body);
      const role = await prisma.role.create({
        data: {
          name: body.name,
          description: body.description,
          permissions: body.permissionIds ? { create: body.permissionIds.map((pid) => ({ permissionId: pid })) } : undefined,
        },
        include: { permissions: { include: { permission: true } } },
      });
      return reply.status(201).send(role);
    } catch (err) { return handleError(reply, err); }
  });

  fastify.get('/permissions', { preHandler: [authenticate] }, async (_request, reply) => {
    try {
      return await prisma.permission.findMany({ orderBy: [{ module: 'asc' }, { action: 'asc' }] });
    } catch (err) { return handleError(reply, err); }
  });

  // ── Audit Log ───────────────────────────────────────────────────────────────

  fastify.get('/audit-log', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    try {
      // SOC2 CC7 / OWASP API1 — Restrict audit log to the caller's company only
      const { companyId } = request.user as { companyId: string };
      const { skip, take, page, limit } = parsePagination(request.query as { page?: number; limit?: number });
      const { entity, userId } = request.query as { entity?: string; userId?: string };
      const where = {
        // Only show logs from users in the same company
        user: { companyId },
        ...(entity && { entity }),
        ...(userId && { userId }),
      };
      const [data, total] = await Promise.all([
        prisma.auditLog.findMany({
          where, skip, take, orderBy: { createdAt: 'desc' },
          include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
        }),
        prisma.auditLog.count({ where }),
      ]);
      return paginatedResponse(data, total, page, limit);
    } catch (err) { return handleError(reply, err); }
  });
};
