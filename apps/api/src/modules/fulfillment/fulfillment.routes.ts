import { FastifyInstance } from 'fastify';
import { prisma } from '../../config/database';
import { authenticate, requirePermission } from '../../middleware/auth.middleware';
import { handleError, NotFoundError, ConflictError, ValidationError } from '../../utils/errors';
import { AUTO_FULFILLMENT_TAG, runFulfillmentCheckForCompany } from './fulfillment.scheduler';

export async function fulfillmentRoutes(fastify: FastifyInstance): Promise<void> {
  // ── List all rules ─────────────────────────────────────────────────────────
  fastify.get(
    '/rules',
    { preHandler: [authenticate, requirePermission('inventory', 'read')] },
    async (request, reply) => {
      const { companyId } = request.user as any;
      try {
        const rules = await (prisma as any).autoFulfillmentRule.findMany({
          where: { companyId, deletedAt: null },
          include: {
            product: { select: { id: true, code: true, description: true, uom: true } },
            supplier: { select: { id: true, code: true, name: true } },
          },
          orderBy: { createdAt: 'desc' },
        });
        return reply.send(rules);
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );

  // ── Create a rule ──────────────────────────────────────────────────────────
  fastify.post(
    '/rules',
    { preHandler: [authenticate, requirePermission('inventory', 'create')] },
    async (request, reply) => {
      const { companyId, sub: userId } = request.user as any;
      const body = request.body as any;

      if (!body.productId || !body.supplierId || body.reorderPoint == null || body.reorderQty == null) {
        throw new ValidationError('productId, supplierId, reorderPoint and reorderQty are required');
      }

      try {
        // Enforce one rule per product per company
        const existing = await (prisma as any).autoFulfillmentRule.findFirst({
          where: { companyId, productId: body.productId, deletedAt: null },
        });
        if (existing) {
          throw new ConflictError('A fulfillment rule already exists for this product in this company.');
        }

        const unitPriceCents = body.unitPrice != null
          ? Math.round(parseFloat(String(body.unitPrice)) * 100)
          : 0;

        const rule = await (prisma as any).autoFulfillmentRule.create({
          data: {
            companyId,
            productId: body.productId,
            supplierId: body.supplierId,
            isActive: body.isActive ?? true,
            reorderPoint: body.reorderPoint,
            reorderQty: body.reorderQty,
            unitPrice: BigInt(unitPriceCents),
            leadTimeDays: body.leadTimeDays ?? null,
            notes: body.notes ?? null,
            createdBy: userId,
            updatedBy: userId,
          },
          include: {
            product: { select: { id: true, code: true, description: true, uom: true } },
            supplier: { select: { id: true, code: true, name: true } },
          },
        });

        return reply.status(201).send(rule);
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );

  // ── Update a rule ──────────────────────────────────────────────────────────
  fastify.put(
    '/rules/:id',
    { preHandler: [authenticate, requirePermission('inventory', 'edit')] },
    async (request, reply) => {
      const { companyId, sub: userId } = request.user as any;
      const { id } = request.params as { id: string };
      const body = request.body as any;

      try {
        const rule = await (prisma as any).autoFulfillmentRule.findFirst({
          where: { id, companyId, deletedAt: null },
        });
        if (!rule) throw new NotFoundError('AutoFulfillmentRule', id);

        const unitPriceCents = body.unitPrice != null
          ? Math.round(parseFloat(String(body.unitPrice)) * 100)
          : Number(rule.unitPrice);

        const updated = await (prisma as any).autoFulfillmentRule.update({
          where: { id },
          data: {
            supplierId:   body.supplierId   ?? rule.supplierId,
            isActive:     body.isActive     ?? rule.isActive,
            reorderPoint: body.reorderPoint ?? rule.reorderPoint,
            reorderQty:   body.reorderQty   ?? rule.reorderQty,
            unitPrice:    BigInt(unitPriceCents),
            leadTimeDays: body.leadTimeDays !== undefined ? body.leadTimeDays : rule.leadTimeDays,
            notes:        body.notes        !== undefined ? body.notes        : rule.notes,
            updatedBy:    userId,
          },
          include: {
            product: { select: { id: true, code: true, description: true, uom: true } },
            supplier: { select: { id: true, code: true, name: true } },
          },
        });

        return reply.send(updated);
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );

  // ── Delete a rule (soft) ───────────────────────────────────────────────────
  fastify.delete(
    '/rules/:id',
    { preHandler: [authenticate, requirePermission('inventory', 'delete')] },
    async (request, reply) => {
      const { companyId } = request.user as any;
      const { id } = request.params as { id: string };

      try {
        const rule = await (prisma as any).autoFulfillmentRule.findFirst({
          where: { id, companyId, deletedAt: null },
        });
        if (!rule) throw new NotFoundError('AutoFulfillmentRule', id);

        await (prisma as any).autoFulfillmentRule.update({
          where: { id },
          data: { deletedAt: new Date() },
        });

        return reply.send({ success: true });
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );

  // ── Manually trigger the fulfillment check for this company ───────────────
  fastify.post(
    '/check',
    { preHandler: [authenticate, requirePermission('inventory', 'create')] },
    async (request, reply) => {
      const { companyId } = request.user as any;
      try {
        const result = await runFulfillmentCheckForCompany(fastify, companyId);
        return reply.send(result);
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );

  // ── List recent auto-generated draft POs for this company ─────────────────
  fastify.get(
    '/recent-pos',
    { preHandler: [authenticate, requirePermission('purchasing', 'read')] },
    async (request, reply) => {
      const { companyId } = request.user as any;
      const query = request.query as { page?: string; limit?: string };
      const page  = Math.max(1, parseInt(query.page  ?? '1',  10));
      const limit = Math.min(50, parseInt(query.limit ?? '20', 10));

      try {
        const [data, total] = await Promise.all([
          prisma.purchaseOrder.findMany({
            where: {
              companyId,
              deletedAt: null,
              notes: { startsWith: AUTO_FULFILLMENT_TAG },
            },
            include: {
              supplier: { select: { id: true, code: true, name: true } },
              lines: {
                include: {
                  product: { select: { id: true, code: true, description: true, uom: true } },
                },
              },
            },
            orderBy: { createdAt: 'desc' },
            skip: (page - 1) * limit,
            take: limit,
          }),
          prisma.purchaseOrder.count({
            where: {
              companyId,
              deletedAt: null,
              notes: { startsWith: AUTO_FULFILLMENT_TAG },
            },
          }),
        ]);

        return reply.send({
          data,
          meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
        });
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );
}
