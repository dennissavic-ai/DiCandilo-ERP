import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { authenticate, requirePermission } from '../../middleware/auth.middleware';
import { writeAuditLog } from '../../middleware/audit.middleware';
import { handleError, NotFoundError, ConflictError, ValidationError } from '../../utils/errors';
import { parsePagination, paginatedResponse } from '../../utils/pagination';
import { InventoryService } from '../inventory/inventory.service';

const inventoryService = new InventoryService();

// ── Sequential number generation with collision retry ──────────────────────
async function generateSequentialNumber(
  companyId: string,
  prefix: string,
  model: 'salesOrder' | 'salesQuote' | 'invoice' | 'purchaseOrder' | 'workOrder' | 'shipmentManifest' | 'pickList',
): Promise<string> {
  const numberField =
    model === 'salesOrder' ? 'orderNumber' :
    model === 'salesQuote' ? 'quoteNumber' :
    model === 'invoice' ? 'invoiceNumber' :
    model === 'purchaseOrder' ? 'poNumber' :
    model === 'workOrder' ? 'workOrderNumber' :
    model === 'shipmentManifest' ? 'manifestNumber' :
    'pickNumber';

  for (let attempt = 0; attempt < 5; attempt++) {
    const count = await (prisma as any)[model].count({ where: { companyId } });
    const num = `${prefix}-${String(count + 1 + attempt).padStart(6, '0')}`;
    const existing = await (prisma as any)[model].findFirst({
      where: { companyId, [numberField]: num },
    });
    if (!existing) return num;
  }
  return `${prefix}-${Date.now()}`;
}

/** Post AP journal: DR Inventory (1200) / CR Accounts Payable (2000) */
async function postPOReceiptToGL(companyId: string, poId: string, amount: number, userId: string) {
  if (amount <= 0) return;
  const now = new Date();
  const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [invAccount, apAccount] = await Promise.all([
    prisma.gLAccount.findFirst({ where: { companyId, code: '1200' } }),
    prisma.gLAccount.findFirst({ where: { companyId, code: '2000' } }),
  ]);
  if (!invAccount || !apAccount) return; // GL accounts not yet configured — skip silently
  const count = await prisma.journalEntry.count({ where: { companyId } });
  await prisma.journalEntry.create({
    data: {
      companyId,
      entryNumber: `JE-AUTO-${String(count + 1).padStart(6, '0')}`,
      description: `PO receipt ${poId} — inventory received`,
      postingDate: now,
      period,
      createdBy: userId,
      lines: {
        create: [
          { companyId, glAccountId: invAccount.id, description: 'Inventory received', debitAmount: amount, creditAmount: 0, postingDate: now, period, sourceType: 'PO', sourceId: poId, purchaseOrderId: poId, createdBy: userId },
          { companyId, glAccountId: apAccount.id, description: 'Accounts Payable — supplier', debitAmount: 0, creditAmount: amount, postingDate: now, period, sourceType: 'PO', sourceId: poId, purchaseOrderId: poId, createdBy: userId },
        ],
      },
    },
  });
}

export const purchasingRoutes: FastifyPluginAsync = async (fastify) => {

  // ── Suppliers ───────────────────────────────────────────────────────────────

  fastify.get('/suppliers', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const { companyId } = request.user as { companyId: string };
      const { skip, take, page, limit } = parsePagination(request.query as { page?: number; limit?: number });
      const { search } = request.query as { search?: string };
      const where = {
        companyId, deletedAt: null, isActive: true,
        ...(search && {
          OR: [
            { name: { contains: search, mode: 'insensitive' as const } },
            { code: { contains: search, mode: 'insensitive' as const } },
          ]
        }),
      };
      const [data, total] = await Promise.all([
        prisma.supplier.findMany({ where, skip, take, orderBy: { name: 'asc' } }),
        prisma.supplier.count({ where }),
      ]);
      return paginatedResponse(data, total, page, limit);
    } catch (err) { return handleError(reply, err); }
  });

  fastify.get('/suppliers/:id', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const { companyId } = request.user as { companyId: string };
      const { id } = request.params as { id: string };
      const s = await prisma.supplier.findFirst({ where: { id, companyId, deletedAt: null } });
      if (!s) throw new NotFoundError('Supplier', id);
      return s;
    } catch (err) { return handleError(reply, err); }
  });

  fastify.post('/suppliers', { preHandler: [authenticate, requirePermission('purchasing', 'create')] }, async (request, reply) => {
    try {
      const { companyId, sub } = request.user as { companyId: string; sub: string };
      const body = z.object({
        code: z.string().min(1),
        name: z.string().min(1),
        legalName: z.string().optional(),
        taxId: z.string().optional(),
        currencyCode: z.string().default('USD'),
        paymentTerms: z.number().int().min(0).default(30),
        billingAddress: z.record(z.unknown()).optional(),
        contacts: z.array(z.record(z.unknown())).optional(),
        notes: z.string().optional(),
      }).parse(request.body);
      const existing = await prisma.supplier.findFirst({ where: { companyId, code: body.code, deletedAt: null } });
      if (existing) throw new ConflictError(`Supplier code '${body.code}' already exists`);
      const supplier = await prisma.supplier.create({ data: { companyId, ...body, billingAddress: body.billingAddress as Prisma.InputJsonValue, contacts: body.contacts as Prisma.InputJsonValue, createdBy: sub, updatedBy: sub } });
      await writeAuditLog(request, 'CREATE', 'Supplier', supplier.id, null, { code: body.code, name: body.name });
      return reply.status(201).send(supplier);
    } catch (err) { return handleError(reply, err); }
  });

  fastify.put('/suppliers/:id', { preHandler: [authenticate, requirePermission('purchasing', 'edit')] }, async (request, reply) => {
    try {
      const { companyId, sub } = request.user as { companyId: string; sub: string };
      const { id } = request.params as { id: string };
      const s = await prisma.supplier.findFirst({ where: { id, companyId, deletedAt: null } });
      if (!s) throw new NotFoundError('Supplier', id);
      const updateBody = z.object({
        name: z.string().min(1).optional(),
        legalName: z.string().optional(),
        taxId: z.string().optional(),
        currencyCode: z.string().optional(),
        paymentTerms: z.number().int().min(0).optional(),
        billingAddress: z.record(z.unknown()).optional(),
        contacts: z.array(z.record(z.unknown())).optional(),
        notes: z.string().optional(),
        isActive: z.boolean().optional(),
      }).parse(request.body);
      const updated = await prisma.supplier.update({ where: { id }, data: { ...updateBody, updatedBy: sub } });
      await writeAuditLog(request, 'UPDATE', 'Supplier', id, null, updateBody);
      return updated;
    } catch (err) { return handleError(reply, err); }
  });

  // ── Purchase Orders ─────────────────────────────────────────────────────────

  fastify.get('/orders', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const { companyId } = request.user as { companyId: string };
      const { skip, take, page, limit } = parsePagination(request.query as { page?: number; limit?: number });
      const { status, supplierId } = request.query as { status?: string; supplierId?: string };
      const where = {
        companyId, deletedAt: null,
        ...(status && { status: status as 'DRAFT' }),
        ...(supplierId && { supplierId }),
      };
      const [data, total] = await Promise.all([
        prisma.purchaseOrder.findMany({
          where, skip, take, orderBy: { createdAt: 'desc' },
          include: {
            supplier: { select: { id: true, name: true, code: true } },
            _count: { select: { lines: true } },
          },
        }),
        prisma.purchaseOrder.count({ where }),
      ]);
      return paginatedResponse(data, total, page, limit);
    } catch (err) { return handleError(reply, err); }
  });

  fastify.get('/orders/:id', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const { companyId } = request.user as { companyId: string };
      const { id } = request.params as { id: string };
      const po = await prisma.purchaseOrder.findFirst({
        where: { id, companyId, deletedAt: null },
        include: {
          supplier: true,
          lines: { include: { product: { select: { id: true, code: true, description: true, uom: true } } } },
          receipts: { include: { lines: true } },
        },
      });
      if (!po) throw new NotFoundError('PurchaseOrder', id);
      return po;
    } catch (err) { return handleError(reply, err); }
  });

  const poLineSchema = z.object({
    productId: z.string().uuid(),
    description: z.string().optional(),
    uom: z.string(),
    qtyOrdered: z.number().positive(),
    unitPrice: z.number().int().min(0),
    expectedDate: z.string().datetime().optional(),
    notes: z.string().optional(),
  });

  fastify.post('/orders', { preHandler: [authenticate, requirePermission('purchasing', 'create')] }, async (request, reply) => {
    try {
      const { companyId, branchId, sub } = request.user as { companyId: string; branchId: string; sub: string };
      const body = z.object({
        supplierId: z.string().uuid(),
        orderDate: z.string().datetime().optional(),
        expectedDate: z.string().datetime().optional(),
        currencyCode: z.string().default('USD'),
        freightCost: z.number().int().min(0).default(0),
        dutyCost: z.number().int().min(0).default(0),
        otherCosts: z.number().int().min(0).default(0),
        notes: z.string().optional(),
        terms: z.string().optional(),
        lines: z.array(poLineSchema).min(1),
      }).parse(request.body);

      // Generate PO number with collision retry
      const poNumber = await generateSequentialNumber(companyId, 'PO', 'purchaseOrder');

      const subtotal = body.lines.reduce((sum, l) => sum + Math.round(l.qtyOrdered * l.unitPrice), 0);
      const totalCost = subtotal + body.freightCost + body.dutyCost + body.otherCosts;

      const po = await prisma.purchaseOrder.create({
        data: {
          companyId,
          branchId: branchId ?? '',
          supplierId: body.supplierId,
          poNumber,
          orderDate: body.orderDate ? new Date(body.orderDate) : undefined,
          expectedDate: body.expectedDate ? new Date(body.expectedDate) : undefined,
          currencyCode: body.currencyCode,
          freightCost: body.freightCost,
          dutyCost: body.dutyCost,
          otherCosts: body.otherCosts,
          subtotal,
          totalCost,
          notes: body.notes,
          terms: body.terms,
          createdBy: sub,
          updatedBy: sub,
          lines: {
            create: body.lines.map((l, i) => ({
              lineNumber: i + 1,
              productId: l.productId,
              description: l.description,
              uom: l.uom,
              qtyOrdered: l.qtyOrdered,
              unitPrice: l.unitPrice,
              lineTotal: Math.round(l.qtyOrdered * l.unitPrice),
              expectedDate: l.expectedDate ? new Date(l.expectedDate) : undefined,
              notes: l.notes,
            })),
          },
        },
        include: { lines: true, supplier: true },
      });
      await writeAuditLog(request, 'CREATE', 'PurchaseOrder', po.id, null, { poNumber });
      return reply.status(201).send(po);
    } catch (err) { return handleError(reply, err); }
  });

  // Add line to existing PO
  fastify.post('/orders/:id/lines', { preHandler: [authenticate, requirePermission('purchasing', 'create')] }, async (request, reply) => {
    try {
      const { companyId, sub } = request.user as { companyId: string; sub: string };
      const { id } = request.params as { id: string };

      const po = await prisma.purchaseOrder.findFirst({
        where: { id, companyId, deletedAt: null },
        include: { lines: true },
      });
      if (!po) throw new NotFoundError('PurchaseOrder', id);
      if (po.status !== 'DRAFT') throw new Error('Can only add lines to DRAFT POs');

      const body = poLineSchema.parse(request.body);
      const nextLineNumber = po.lines.length + 1;
      const lineTotal = Math.round(body.qtyOrdered * body.unitPrice);

      const line = await prisma.purchaseOrderLine.create({
        data: {
          purchaseOrderId: id,
          lineNumber: nextLineNumber,
          productId: body.productId,
          description: body.description,
          uom: body.uom,
          qtyOrdered: body.qtyOrdered,
          unitPrice: body.unitPrice,
          lineTotal,
          expectedDate: body.expectedDate ? new Date(body.expectedDate) : undefined,
          notes: body.notes,
        },
      });

      // Recalculate PO totals
      const allLines = await prisma.purchaseOrderLine.findMany({ where: { purchaseOrderId: id } });
      const subtotal = allLines.reduce((sum, l) => sum + Number(l.lineTotal), 0);
      const totalCost = subtotal + Number(po.freightCost) + Number(po.dutyCost) + Number(po.otherCosts);
      await prisma.purchaseOrder.update({
        where: { id },
        data: { subtotal, totalCost, updatedBy: sub },
      });

      return reply.status(201).send(line);
    } catch (err) { return handleError(reply, err); }
  });

  // Submit / approve PO
  fastify.patch('/orders/:id/submit', { preHandler: [authenticate, requirePermission('purchasing', 'edit')] }, async (request, reply) => {
    try {
      const { companyId, sub } = request.user as { companyId: string; sub: string };
      const { id } = request.params as { id: string };
      const existing = await prisma.purchaseOrder.findFirst({ where: { id, companyId, deletedAt: null } });
      if (!existing) throw new NotFoundError('PurchaseOrder', id);
      if (existing.status !== 'DRAFT') throw new ValidationError(`Can only submit DRAFT POs, current: ${existing.status}`);
      const po = await prisma.purchaseOrder.update({
        where: { id },
        data: { status: 'SUBMITTED', updatedBy: sub },
      });
      await writeAuditLog(request, 'UPDATE', 'PurchaseOrder', id, null, { status: 'SUBMITTED' });
      return po;
    } catch (err) { return handleError(reply, err); }
  });

  fastify.patch('/orders/:id/approve', { preHandler: [authenticate, requirePermission('purchasing', 'approve')] }, async (request, reply) => {
    try {
      const { companyId, sub } = request.user as { companyId: string; sub: string };
      const { id } = request.params as { id: string };
      const existing = await prisma.purchaseOrder.findFirst({ where: { id, companyId, deletedAt: null } });
      if (!existing) throw new NotFoundError('PurchaseOrder', id);
      if (existing.status !== 'SUBMITTED') throw new ValidationError(`Can only approve SUBMITTED POs, current: ${existing.status}`);
      const po = await prisma.purchaseOrder.update({
        where: { id },
        data: {
          status: 'APPROVED',
          approvedBy: sub,
          approvedAt: new Date(),
          updatedBy: sub,
        },
      });
      await writeAuditLog(request, 'UPDATE', 'PurchaseOrder', id, null, { status: 'APPROVED' });
      return po;
    } catch (err) { return handleError(reply, err); }
  });

  // PO Receipt — creates receipt, updates inventory, posts AP GL, updates PO line/status
  fastify.post('/orders/:id/receipts', { preHandler: [authenticate, requirePermission('purchasing', 'create')] }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const { sub, companyId } = request.user as { sub: string; companyId: string };
      const body = z.object({
        lines: z.array(z.object({
          purchaseOrderLineId: z.string().uuid(),
          qtyReceived: z.number().positive(),
          locationId: z.string().uuid().optional(),
          heatNumber: z.string().optional(),
          certNumber: z.string().optional(),
          thickness: z.number().int().positive().optional(),
          width: z.number().int().positive().optional(),
          length: z.number().int().positive().optional(),
        })),
        notes: z.string().optional(),
      }).parse(request.body);

      const po = await prisma.purchaseOrder.findFirst({
        where: { id, companyId, deletedAt: null },
        include: { lines: true },
      });
      if (!po) throw new NotFoundError('PurchaseOrder', id);

      // Build a map of PO lines for cost/product lookup
      const poLineMap = new Map(po.lines.map((l) => [l.id, l]));

      const count = await prisma.pOReceipt.count({ where: { purchaseOrderId: id } });
      const receiptNumber = `REC-${id.slice(0, 8)}-${count + 1}`;

      const receipt = await prisma.$transaction(async (tx) => {
        const rec = await tx.pOReceipt.create({
          data: {
            purchaseOrderId: id,
            receiptNumber,
            receivedBy: sub,
            notes: body.notes,
            createdBy: sub,
            lines: {
              create: body.lines.map((l) => ({
                purchaseOrderLineId: l.purchaseOrderLineId,
                qtyReceived: l.qtyReceived,
                qtyAccepted: l.qtyReceived,
                heatNumber: l.heatNumber,
                certNumber: l.certNumber,
                locationId: l.locationId,
              })),
            },
          },
          include: { lines: true },
        });

        // ── Step 1: receive stock into inventory ──────────────────────────────
        const defaultLocationId = body.lines.find((l) => l.locationId)?.locationId;
        if (defaultLocationId) {
          const invLines = body.lines
            .map((l) => {
              const poLine = poLineMap.get(l.purchaseOrderLineId);
              if (!poLine) return null;
              return {
                productId: poLine.productId,
                qtyReceived: l.qtyReceived,
                unitCost: Number(poLine.unitPrice),
                heatNumber: l.heatNumber,
                certNumber: l.certNumber,
                thickness: l.thickness,
                width: l.width,
                length: l.length,
              };
            })
            .filter((l): l is NonNullable<typeof l> => l !== null);

          if (invLines.length > 0) {
            await inventoryService.receiveStock(
              { purchaseOrderId: id, locationId: defaultLocationId, lines: invLines, notes: body.notes, createdBy: sub },
              companyId
            );
          }
        }

        // ── Step 2: update PO line qtyReceived ───────────────────────────────
        for (const rl of body.lines) {
          const poLine = poLineMap.get(rl.purchaseOrderLineId);
          if (!poLine) continue;
          const newQtyReceived = Number(poLine.qtyReceived) + rl.qtyReceived;
          await tx.purchaseOrderLine.update({
            where: { id: rl.purchaseOrderLineId },
            data: { qtyReceived: newQtyReceived },
          });
        }

        // ── Step 3: update PO status ─────────────────────────────────────────
        const updatedLines = await tx.purchaseOrderLine.findMany({ where: { purchaseOrderId: id } });
        const allFulfilled = updatedLines.every((l) => Number(l.qtyReceived) >= Number(l.qtyOrdered));
        const anyFulfilled = updatedLines.some((l) => Number(l.qtyReceived) > 0);
        await tx.purchaseOrder.update({
          where: { id },
          data: { status: allFulfilled ? 'RECEIVED' : anyFulfilled ? 'PARTIALLY_RECEIVED' : undefined, updatedBy: sub },
        });

        return rec;
      });

      // ── Step 4: post AP GL entry (DR Inventory / CR Accounts Payable) ────
      const receiptTotal = body.lines.reduce((sum, l) => {
        const poLine = poLineMap.get(l.purchaseOrderLineId);
        return sum + (poLine ? l.qtyReceived * Number(poLine.unitPrice) : 0);
      }, 0);
      postPOReceiptToGL(companyId, id, Math.round(receiptTotal), sub).catch((e) =>
        console.error('[GL] PO receipt posting failed:', e)
      );

      await writeAuditLog(request, 'CREATE', 'POReceipt', receipt.id, null, { purchaseOrderId: id, receiptNumber });
      return reply.status(201).send(receipt);
    } catch (err) { return handleError(reply, err); }
  });
};
