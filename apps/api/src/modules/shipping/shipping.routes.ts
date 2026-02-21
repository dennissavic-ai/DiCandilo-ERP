import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../config/database';
import { authenticate, requirePermission } from '../../middleware/auth.middleware';
import { handleError, NotFoundError } from '../../utils/errors';
import { parsePagination, paginatedResponse } from '../../utils/pagination';

export const shippingRoutes: FastifyPluginAsync = async (fastify) => {

  // ── Pick Lists ──────────────────────────────────────────────────────────────

  fastify.get('/pick-lists', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const { skip, take, page, limit } = parsePagination(request.query as { page?: number; limit?: number });
      const [data, total] = await Promise.all([
        prisma.pickList.findMany({
          skip, take, orderBy: { createdAt: 'desc' },
          include: { _count: { select: { lines: true } } },
        }),
        prisma.pickList.count(),
      ]);
      return paginatedResponse(data, total, page, limit);
    } catch (err) { return handleError(reply, err); }
  });

  fastify.post('/pick-lists', { preHandler: [authenticate, requirePermission('shipping', 'create')] }, async (request, reply) => {
    try {
      const { sub } = request.user as { sub: string };
      const body = z.object({
        manifestId: z.string().uuid().optional(),
        assignedTo: z.string().uuid().optional(),
        lines: z.array(z.object({
          salesOrderLineId: z.string().uuid(),
          inventoryItemId: z.string().uuid().optional(),
          qtyRequired: z.number().positive(),
        })).min(1),
      }).parse(request.body);

      const count = await prisma.pickList.count();
      const pickNumber = `PK-${String(count + 1).padStart(6, '0')}`;

      const pick = await prisma.pickList.create({
        data: {
          pickNumber,
          manifestId: body.manifestId,
          assignedTo: body.assignedTo,
          createdBy: sub,
          lines: {
            create: body.lines.map((l) => ({
              salesOrderLineId: l.salesOrderLineId,
              inventoryItemId: l.inventoryItemId,
              qtyRequired: l.qtyRequired,
            })),
          },
        },
        include: { lines: true },
      });
      return reply.status(201).send(pick);
    } catch (err) { return handleError(reply, err); }
  });

  // Confirm pick of a line
  fastify.patch('/pick-lists/:pickId/lines/:lineId/pick', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const { pickId, lineId } = request.params as { pickId: string; lineId: string };
      const { sub } = request.user as { sub: string };
      const { qtyPicked } = z.object({ qtyPicked: z.number().positive() }).parse(request.body);
      const line = await prisma.pickLine.update({
        where: { id: lineId },
        data: { qtyPicked, pickedAt: new Date(), pickedBy: sub },
      });
      // Check if all lines on pick list are done
      const allLines = await prisma.pickLine.findMany({ where: { pickListId: pickId } });
      const allPicked = allLines.every((l) => Number(l.qtyPicked) >= Number(l.qtyRequired));
      if (allPicked) {
        await prisma.pickList.update({ where: { id: pickId }, data: { status: 'COMPLETE', completedAt: new Date() } });
      }
      return line;
    } catch (err) { return handleError(reply, err); }
  });

  // ── Shipment Manifests ──────────────────────────────────────────────────────

  fastify.get('/manifests', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const { companyId } = request.user as { companyId: string };
      const { skip, take, page, limit } = parsePagination(request.query as { page?: number; limit?: number });
      const [data, total] = await Promise.all([
        prisma.shipmentManifest.findMany({
          where: { companyId, deletedAt: null },
          skip, take, orderBy: { createdAt: 'desc' },
          include: { salesOrder: { select: { orderNumber: true, customer: { select: { name: true } } } } },
        }),
        prisma.shipmentManifest.count({ where: { companyId, deletedAt: null } }),
      ]);
      return paginatedResponse(data, total, page, limit);
    } catch (err) { return handleError(reply, err); }
  });

  fastify.post('/manifests', { preHandler: [authenticate, requirePermission('shipping', 'create')] }, async (request, reply) => {
    try {
      const { companyId, sub } = request.user as { companyId: string; sub: string };
      const body = z.object({
        salesOrderId: z.string().uuid().optional(),
        carrier: z.string().optional(),
        service: z.string().optional(),
        freightCost: z.number().int().min(0).default(0),
        notes: z.string().optional(),
      }).parse(request.body);
      const count = await prisma.shipmentManifest.count({ where: { companyId } });
      const manifestNumber = `MAN-${String(count + 1).padStart(6, '0')}`;
      const manifest = await prisma.shipmentManifest.create({
        data: { companyId, manifestNumber, ...body, createdBy: sub },
      });
      return reply.status(201).send(manifest);
    } catch (err) { return handleError(reply, err); }
  });

  fastify.patch('/manifests/:id/ship', { preHandler: [authenticate, requirePermission('shipping', 'edit')] }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = z.object({
        trackingNumber: z.string().optional(),
        shipDate: z.string().datetime().optional(),
      }).parse(request.body);
      const manifest = await prisma.shipmentManifest.update({
        where: { id },
        data: { status: 'SHIPPED', trackingNumber: body.trackingNumber, shipDate: body.shipDate ? new Date(body.shipDate) : new Date() },
      });
      return manifest;
    } catch (err) { return handleError(reply, err); }
  });

  fastify.patch('/manifests/:id/deliver', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const { proofOfDelivery } = z.object({ proofOfDelivery: z.string().optional() }).parse(request.body);
      const manifest = await prisma.shipmentManifest.update({
        where: { id },
        data: { status: 'DELIVERED', deliveredAt: new Date(), proofOfDelivery },
      });
      return manifest;
    } catch (err) { return handleError(reply, err); }
  });
};
