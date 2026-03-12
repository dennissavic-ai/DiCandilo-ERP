import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../config/database';
import { authenticate, requirePermission } from '../../middleware/auth.middleware';
import { handleError, NotFoundError, ValidationError } from '../../utils/errors';
import { parsePagination, paginatedResponse } from '../../utils/pagination';
import { InventoryService } from '../inventory/inventory.service';

const inventoryService = new InventoryService();

/** Promote a DRAFT invoice to SENT (or create one) and post AR/Revenue GL when an order ships. */
async function autoInvoiceOnShipment(salesOrderId: string, companyId: string, userId: string) {
  const so = await prisma.salesOrder.findFirst({
    where: { id: salesOrderId, companyId, deletedAt: null },
    include: { lines: true, customer: true, invoices: { where: { deletedAt: null } } },
  });
  if (!so) return;

  const now = new Date();
  const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  // Skip if a non-draft invoice already exists (e.g. SENT, PAID)
  const alreadyIssued = so.invoices.find((inv) => inv.status !== 'DRAFT');
  if (alreadyIssued) return;

  let invoice: { id: string };
  let invoiceNumber: string;

  const draftInvoice = so.invoices.find((inv) => inv.status === 'DRAFT');
  if (draftInvoice) {
    // Promote the draft: mark SENT and set invoiceDate to now
    invoiceNumber = draftInvoice.invoiceNumber;
    invoice = await prisma.invoice.update({
      where: { id: draftInvoice.id },
      data: { status: 'SENT', invoiceDate: now, updatedBy: userId },
    });
  } else {
    // No draft exists — create a fresh SENT invoice (fallback path)
    const dueDate = new Date(now);
    dueDate.setDate(dueDate.getDate() + (so.customer?.creditTerms ?? 30));
    const count = await prisma.invoice.count({ where: { companyId } });
    invoiceNumber = `INV-${String(count + 1).padStart(6, '0')}`;

    invoice = await prisma.invoice.create({
      data: {
        companyId,
        customerId: so.customerId,
        salesOrderId: so.id,
        invoiceNumber,
        dueDate,
        currencyCode: so.currencyCode,
        subtotal: so.subtotal,
        discountAmount: so.discountAmount,
        taxAmount: so.taxAmount,
        freightAmount: so.freightAmount,
        totalAmount: so.totalAmount,
        balanceDue: so.totalAmount,
        terms: so.terms,
        notes: so.notes,
        status: 'SENT',
        createdBy: userId,
        updatedBy: userId,
        lines: {
          create: so.lines.map((l) => ({
            salesOrderLineId: l.id,
            lineNumber: l.lineNumber,
            description: l.description,
            uom: l.uom,
            qty: l.qtyOrdered,
            unitPrice: l.unitPrice,
            discountPct: l.discountPct,
            lineSubtotal: l.lineTotal,
            lineTotal: l.lineTotal,
          })),
        },
      },
    });
  }

  // Post GL: DR Accounts Receivable (1100) / CR Sales Revenue (4000)
  const [arAcct, revAcct] = await Promise.all([
    prisma.gLAccount.findFirst({ where: { companyId, code: '1100' } }),
    prisma.gLAccount.findFirst({ where: { companyId, code: '4000' } }),
  ]);
  if (arAcct && revAcct) {
    const jeCount = await prisma.journalEntry.count({ where: { companyId } });
    const amount = Number(so.totalAmount);
    await prisma.journalEntry.create({
      data: {
        companyId,
        entryNumber: `JE-AUTO-${String(jeCount + 1).padStart(6, '0')}`,
        description: `Auto-invoice ${invoiceNumber} on shipment of ${so.orderNumber}`,
        postingDate: now,
        period,
        createdBy: userId,
        lines: {
          create: [
            { companyId, glAccountId: arAcct.id, description: 'Accounts Receivable', debitAmount: amount, creditAmount: 0, postingDate: now, period, sourceType: 'INVOICE', sourceId: invoice.id, invoiceId: invoice.id, createdBy: userId },
            { companyId, glAccountId: revAcct.id, description: 'Sales Revenue', debitAmount: 0, creditAmount: amount, postingDate: now, period, sourceType: 'INVOICE', sourceId: invoice.id, invoiceId: invoice.id, createdBy: userId },
          ],
        },
      },
    });
  }

  // Update SO status to INVOICED
  await prisma.salesOrder.update({ where: { id: salesOrderId }, data: { status: 'INVOICED', updatedBy: userId } });
}

export const shippingRoutes: FastifyPluginAsync = async (fastify) => {

  // ── Pick Lists ──────────────────────────────────────────────────────────────

  fastify.get('/pick-lists', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const { companyId } = request.user as { companyId: string };
      const { skip, take, page, limit } = parsePagination(request.query as { page?: number; limit?: number });
      const where = {
        manifest: { companyId, deletedAt: null },
      };
      const [data, total] = await Promise.all([
        prisma.pickList.findMany({
          where, skip, take, orderBy: { createdAt: 'desc' },
          include: { _count: { select: { lines: true } } },
        }),
        prisma.pickList.count({ where }),
      ]);
      return paginatedResponse(data, total, page, limit);
    } catch (err) { return handleError(reply, err); }
  });

  fastify.post('/pick-lists', { preHandler: [authenticate, requirePermission('shipping', 'create')] }, async (request, reply) => {
    try {
      const { companyId, sub } = request.user as { companyId: string; sub: string };
      const body = z.object({
        manifestId: z.string().uuid().optional(),
        assignedTo: z.string().uuid().optional(),
        lines: z.array(z.object({
          salesOrderLineId: z.string().uuid(),
          inventoryItemId: z.string().uuid().optional(),
          qtyRequired: z.number().positive(),
        })).min(1),
      }).parse(request.body);

      // Verify the manifest belongs to this company if specified
      if (body.manifestId) {
        const manifest = await prisma.shipmentManifest.findFirst({ where: { id: body.manifestId, companyId, deletedAt: null } });
        if (!manifest) throw new NotFoundError('ShipmentManifest', body.manifestId);
      }

      const count = await prisma.pickList.count({ where: { manifest: { companyId } } });
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

  // Confirm pick of a line — deducts from inventory
  fastify.patch('/pick-lists/:pickId/lines/:lineId/pick', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const { pickId, lineId } = request.params as { pickId: string; lineId: string };
      const { sub } = request.user as { sub: string };
      const { qtyPicked } = z.object({ qtyPicked: z.number().positive() }).parse(request.body);

      const existingLine = await prisma.pickLine.findUnique({ where: { id: lineId } });
      if (!existingLine) throw new NotFoundError('PickLine', lineId);

      const line = await prisma.pickLine.update({
        where: { id: lineId },
        data: { qtyPicked, pickedAt: new Date(), pickedBy: sub },
      });

      // Deduct from physical inventory (ISSUE transaction)
      if (existingLine.inventoryItemId) {
        await inventoryService.issueStock(
          existingLine.inventoryItemId,
          qtyPicked,
          'PICKUP',
          pickId,
          sub
        );
      }

      // Check if all lines on pick list are done → mark complete
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
      const { sub, companyId } = request.user as { sub: string; companyId: string };
      const body = z.object({
        trackingNumber: z.string().optional(),
        shipDate: z.string().datetime().optional(),
      }).parse(request.body);

      const manifest = await prisma.shipmentManifest.update({
        where: { id },
        data: { status: 'SHIPPED', trackingNumber: body.trackingNumber, shipDate: body.shipDate ? new Date(body.shipDate) : new Date() },
      });

      // Auto-generate customer invoice and post GL when shipment is marked shipped
      if (manifest.salesOrderId) {
        try {
          await autoInvoiceOnShipment(manifest.salesOrderId, companyId, sub);
        } catch (e) {
          console.error('[invoice] Auto-invoice on shipment failed:', e);
          throw new ValidationError(`Shipment marked as shipped but auto-invoice failed: ${(e as Error).message}`);
        }
      }

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
