import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import QRCode from 'qrcode';
import bwipjs from 'bwip-js';
import { prisma } from '../../config/database';
import { authenticate } from '../../middleware/auth.middleware';
import { handleError, NotFoundError } from '../../utils/errors';

// ─── Barcode Image Generators ─────────────────────────────────────────────────

async function generateCode128Png(text: string): Promise<string> {
  const png = await bwipjs.toBuffer({
    bcid: 'code128',
    text,
    scale: 3,
    height: 12,
    includetext: true,
    textxalign: 'center',
  });
  return `data:image/png;base64,${png.toString('base64')}`;
}

async function generateGS1128Png(text: string): Promise<string> {
  const png = await bwipjs.toBuffer({
    bcid: 'gs1-128',
    text,
    scale: 3,
    height: 12,
    includetext: true,
    textxalign: 'center',
    parsefnc: true,
  });
  return `data:image/png;base64,${png.toString('base64')}`;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

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

      // Generate barcode image based on requested format
      let imageDataUrl: string;
      if (body.format === 'QR') {
        imageDataUrl = await QRCode.toDataURL(data, { errorCorrectionLevel: 'M', margin: 1 });
      } else if (body.format === 'CODE128') {
        imageDataUrl = await generateCode128Png(data);
      } else {
        // Fallback for CODE39, EAN13, DATAMATRIX: use CODE128 as the rendered image
        imageDataUrl = await generateCode128Png(data);
      }

      // Upsert barcode record
      const existing = await prisma.barcode.findFirst({ where: { entityType: body.entityType, entityId: body.entityId } });
      if (existing) {
        return { barcode: existing, imageUrl: imageDataUrl };
      }

      const barcode = await prisma.barcode.create({
        data: {
          type: body.entityType,
          format: body.format,
          entityType: body.entityType,
          entityId: body.entityId,
          data,
          imageUrl: imageDataUrl.substring(0, 500), // store truncated ref
        },
      });
      return { barcode, imageUrl: imageDataUrl };
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
      } else if (barcode.entityType === 'SHIPMENT') {
        entity = await prisma.shipmentManifest.findFirst({
          where: { id: barcode.entityId },
          include: { pickLists: { select: { id: true, status: true } } },
        });
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

  // ── GET /products/:productId/label — full multi-format label for a product ─

  fastify.get('/products/:productId/label', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const { productId } = request.params as { productId: string };
      const product = await prisma.product.findFirst({ where: { id: productId } });
      if (!product) throw new NotFoundError('Product', productId);

      const sku = product.code; // e.g. "STLPLT-4X8-16GA"
      const qrData = `ERP:PRODUCT:${product.id}`;

      const [qrDataUrl, code128DataUrl] = await Promise.all([
        QRCode.toDataURL(qrData, { errorCorrectionLevel: 'M', margin: 1, width: 200 }),
        generateCode128Png(sku),
      ]);

      // GS1-128: AI (01) internal GTIN-like, AI (21) serial = SKU (up to 20 chars).
      // For internal use: encode "(01)" + first 13 hex chars of UUID padded + "(21)" + SKU.
      let gs1DataUrl: string | null = null;
      try {
        const gs1Text = `(01)${product.id.replace(/-/g, '').substring(0, 13).padEnd(13, '0')}1(21)${sku.substring(0, 20)}`;
        gs1DataUrl = await generateGS1128Png(gs1Text);
      } catch {
        gs1DataUrl = null;
      }

      return {
        productId: product.id,
        sku,
        description: product.description,
        qrCode: {
          format: 'QR',
          standard: 'ISO/IEC 18004',
          dataUrl: qrDataUrl,
          data: qrData,
        },
        code128: {
          format: 'CODE128',
          standard: 'ISO/IEC 15417',
          dataUrl: code128DataUrl,
          data: sku,
        },
        gs1128: gs1DataUrl
          ? { format: 'GS1-128', standard: 'GS1-128 / ISO/IEC 15417', dataUrl: gs1DataUrl }
          : null,
      };
    } catch (err) { return handleError(reply, err); }
  });
};
