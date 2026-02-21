import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import QRCode from 'qrcode';
import { prisma } from '../../config/database';
import { authenticate } from '../../middleware/auth.middleware';
import { handleError, NotFoundError } from '../../utils/errors';

export const barcodeRoutes: FastifyPluginAsync = async (fastify) => {

  // Generate a barcode for an entity
  fastify.post('/generate', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const body = z.object({
        entityType: z.enum(['INVENTORY_ITEM', 'LOCATION', 'WORK_ORDER', 'SHIPMENT', 'PRODUCT']),
        entityId: z.string().uuid(),
        format: z.enum(['QR', 'CODE128', 'CODE39', 'EAN13', 'DATAMATRIX']).default('QR'),
      }).parse(request.body);

      // Create a unique data string
      const data = `ERP:${body.entityType}:${body.entityId}`;

      // Generate QR code as data URL
      const qrDataUrl = await QRCode.toDataURL(data, { errorCorrectionLevel: 'M', margin: 1 });

      // Upsert barcode record
      const existing = await prisma.barcode.findFirst({ where: { entityType: body.entityType, entityId: body.entityId } });
      if (existing) {
        return { barcode: existing, imageUrl: qrDataUrl };
      }

      const barcode = await prisma.barcode.create({
        data: {
          type: body.entityType,
          format: body.format,
          entityType: body.entityType,
          entityId: body.entityId,
          data,
          imageUrl: qrDataUrl.substring(0, 500), // store truncated ref
        },
      });
      return { barcode, imageUrl: qrDataUrl };
    } catch (err) { return handleError(reply, err); }
  });

  // Look up an entity by scanning barcode data
  fastify.post('/scan', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const { data } = z.object({ data: z.string().min(1) }).parse(request.body);

      const barcode = await prisma.barcode.findFirst({ where: { data } });
      if (!barcode) throw new NotFoundError('Barcode');

      // Fetch the entity
      let entity: unknown = null;
      if (barcode.entityType === 'INVENTORY_ITEM') {
        entity = await prisma.inventoryItem.findFirst({
          where: { id: barcode.entityId },
          include: { product: true, location: true },
        });
      } else if (barcode.entityType === 'LOCATION') {
        entity = await prisma.inventoryLocation.findFirst({ where: { id: barcode.entityId } });
      } else if (barcode.entityType === 'WORK_ORDER') {
        entity = await prisma.workOrder.findFirst({ where: { id: barcode.entityId }, include: { lines: true } });
      } else if (barcode.entityType === 'PRODUCT') {
        entity = await prisma.product.findFirst({ where: { id: barcode.entityId } });
      }

      return { barcode, entityType: barcode.entityType, entityId: barcode.entityId, entity };
    } catch (err) { return handleError(reply, err); }
  });

  // List barcodes for an entity
  fastify.get('/:entityType/:entityId', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const { entityType, entityId } = request.params as { entityType: string; entityId: string };
      const barcodes = await prisma.barcode.findMany({ where: { entityType, entityId } });
      return barcodes;
    } catch (err) { return handleError(reply, err); }
  });
};
