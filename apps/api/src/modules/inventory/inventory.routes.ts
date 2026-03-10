import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { prisma } from '../../config/database';
import { InventoryService } from './inventory.service';
import { authenticate, requirePermission } from '../../middleware/auth.middleware';
import { writeAuditLog } from '../../middleware/audit.middleware';
import { handleError } from '../../utils/errors';

const svc = new InventoryService();

// ─── SCHEMAS ──────────────────────────────────────────────────────────────────

const productSchema = z.object({
  code: z.string().min(1).max(50),
  description: z.string().min(1),
  longDescription: z.string().optional(),
  categoryId: z.string().uuid().optional(),
  uom: z.string().default('EA'),
  materialType: z.string().optional(),
  grade: z.string().optional(),
  alloy: z.string().optional(),
  shape: z.string().optional(),
  finish: z.string().optional(),
  coating: z.string().optional(),
  standardLength: z.number().int().positive().optional(),
  standardWidth: z.number().int().positive().optional(),
  standardThickness: z.number().int().positive().optional(),
  weightPerMeter: z.number().int().positive().optional(),
  costMethod: z.enum(['FIFO', 'AVERAGE', 'STANDARD']).optional(),
  standardCost: z.number().int().min(0).optional(),
  listPrice: z.number().int().min(0).optional(),
  reorderPoint: z.number().min(0).optional(),
  reorderQty: z.number().min(0).optional(),
  isBought: z.boolean().optional(),
  isSold: z.boolean().optional(),
  isStocked: z.boolean().optional(),
  trackByHeat: z.boolean().optional(),
  requiresMtr: z.boolean().optional(),
});

const inventoryItemSchema = z.object({
  productId: z.string().uuid(),
  locationId: z.string().uuid(),
  lotNumber: z.string().optional(),
  heatNumber: z.string().optional(),
  certificateNumber: z.string().optional(),
  thickness: z.number().int().positive().optional(),
  width: z.number().int().positive().optional(),
  length: z.number().int().positive().optional(),
  weightGrams: z.number().int().positive().optional(),
  qtyOnHand: z.number().min(0),
  unitCost: z.number().int().min(0),
});

const adjustmentSchema = z.object({
  inventoryItemId: z.string().uuid(),
  quantity: z.number().refine((v) => v !== 0, 'Quantity cannot be zero'),
  reason: z.string().min(1),
  notes: z.string().optional(),
  expectedVersion: z.number().int().min(0),
});

const receiveStockSchema = z.object({
  purchaseOrderId: z.string().uuid().optional(),
  locationId: z.string().uuid(),
  lines: z.array(z.object({
    productId: z.string().uuid(),
    qtyReceived: z.number().positive(),
    unitCost: z.number().int().min(0),
    heatNumber: z.string().optional(),
    certNumber: z.string().optional(),
    thickness: z.number().int().positive().optional(),
    width: z.number().int().positive().optional(),
    length: z.number().int().positive().optional(),
    weightGrams: z.number().int().positive().optional(),
  })).min(1),
  notes: z.string().optional(),
});

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  search: z.string().optional(),
  locationId: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  isRemnant: z.coerce.boolean().optional(),
  lowStock: z.coerce.boolean().optional(),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
});

// ─── ROUTES ───────────────────────────────────────────────────────────────────

export const inventoryRoutes: FastifyPluginAsync = async (fastify) => {

  // ── Product Categories ──────────────────────────────────────────────────────

  fastify.get('/categories', {
    schema: { tags: ['Inventory'] },
    preHandler: [authenticate],
  }, async (request, reply) => {
    try {
      const { companyId } = request.user as { companyId: string };
      return await svc.listCategories(companyId);
    } catch (err) { return handleError(reply, err); }
  });

  fastify.post('/categories', {
    schema: { tags: ['Inventory'] },
    preHandler: [authenticate, requirePermission('inventory', 'create')],
  }, async (request, reply) => {
    try {
      const { companyId, sub } = request.user as { companyId: string; sub: string };
      const body = z.object({
        code: z.string().min(1),
        name: z.string().min(1),
        parentId: z.string().uuid().optional(),
      }).parse(request.body);
      const cat = await svc.createCategory(companyId, body, sub);
      return reply.status(201).send(cat);
    } catch (err) { return handleError(reply, err); }
  });

  // ── Products ────────────────────────────────────────────────────────────────

  fastify.get('/products', {
    schema: { tags: ['Inventory'] },
    preHandler: [authenticate],
  }, async (request, reply) => {
    try {
      const { companyId } = request.user as { companyId: string };
      const query = paginationSchema.parse(request.query);
      return await svc.listProducts(companyId, query);
    } catch (err) { return handleError(reply, err); }
  });

  fastify.get('/products/:id', {
    schema: { tags: ['Inventory'] },
    preHandler: [authenticate],
  }, async (request, reply) => {
    try {
      const { companyId } = request.user as { companyId: string };
      const { id } = request.params as { id: string };
      return await svc.getProduct(companyId, id);
    } catch (err) { return handleError(reply, err); }
  });

  fastify.post('/products', {
    schema: { tags: ['Inventory'] },
    preHandler: [authenticate, requirePermission('inventory', 'create')],
  }, async (request, reply) => {
    try {
      const { companyId, sub } = request.user as { companyId: string; sub: string };
      const body = productSchema.parse(request.body);
      const product = await svc.createProduct(companyId, body, sub);
      await writeAuditLog(request, 'CREATE', 'Product', product.id, null, product);
      return reply.status(201).send(product);
    } catch (err) { return handleError(reply, err); }
  });

  fastify.put('/products/:id', {
    schema: { tags: ['Inventory'] },
    preHandler: [authenticate, requirePermission('inventory', 'edit')],
  }, async (request, reply) => {
    try {
      const { companyId, sub } = request.user as { companyId: string; sub: string };
      const { id } = request.params as { id: string };
      const body = productSchema.partial().parse(request.body);
      const product = await svc.updateProduct(companyId, id, body, sub);
      await writeAuditLog(request, 'UPDATE', 'Product', id, null, product);
      return reply.send(product);
    } catch (err) { return handleError(reply, err); }
  });

  fastify.delete('/products/:id', {
    schema: { tags: ['Inventory'] },
    preHandler: [authenticate, requirePermission('inventory', 'delete')],
  }, async (request, reply) => {
    try {
      const { companyId, sub } = request.user as { companyId: string; sub: string };
      const { id } = request.params as { id: string };
      await svc.deleteProduct(companyId, id, sub);
      await writeAuditLog(request, 'DELETE', 'Product', id, null, null);
      return reply.status(204).send();
    } catch (err) { return handleError(reply, err); }
  });

  // ── Locations ───────────────────────────────────────────────────────────────

  fastify.get('/locations', {
    schema: { tags: ['Inventory'] },
    preHandler: [authenticate],
  }, async (request, reply) => {
    try {
      const { branchId } = request.user as { branchId: string };
      if (!branchId) return reply.status(400).send({ error: 'No branch assigned to user' });
      return await svc.listLocations(branchId);
    } catch (err) { return handleError(reply, err); }
  });

  fastify.post('/locations', {
    schema: { tags: ['Inventory'] },
    preHandler: [authenticate, requirePermission('inventory', 'create')],
  }, async (request, reply) => {
    try {
      const { branchId, sub } = request.user as { branchId: string; sub: string };
      if (!branchId) return reply.status(400).send({ error: 'No branch assigned to user' });
      const body = z.object({
        code: z.string().min(1),
        name: z.string().min(1),
        type: z.string().optional(),
      }).parse(request.body);
      const loc = await svc.createLocation(branchId, body, sub);
      return reply.status(201).send(loc);
    } catch (err) { return handleError(reply, err); }
  });

  // ── Inventory Items ─────────────────────────────────────────────────────────

  fastify.get('/items', {
    schema: { tags: ['Inventory'] },
    preHandler: [authenticate],
  }, async (request, reply) => {
    try {
      const { companyId } = request.user as { companyId: string };
      const query = paginationSchema.parse(request.query);
      return await svc.listInventoryItems(companyId, query);
    } catch (err) { return handleError(reply, err); }
  });

  fastify.get('/items/:id', {
    schema: { tags: ['Inventory'] },
    preHandler: [authenticate],
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      return await svc.getInventoryItem(id);
    } catch (err) { return handleError(reply, err); }
  });

  fastify.post('/items', {
    schema: { tags: ['Inventory'] },
    preHandler: [authenticate, requirePermission('inventory', 'create')],
  }, async (request, reply) => {
    try {
      const { sub } = request.user as { sub: string };
      const body = inventoryItemSchema.parse(request.body);
      const item = await svc.createInventoryItem(body, sub);
      await writeAuditLog(request, 'CREATE', 'InventoryItem', item.id, null, item);
      return reply.status(201).send(item);
    } catch (err) { return handleError(reply, err); }
  });

  // ── Stock Operations ────────────────────────────────────────────────────────

  fastify.post('/adjust', {
    schema: { tags: ['Inventory'] },
    preHandler: [authenticate, requirePermission('inventory', 'edit')],
  }, async (request, reply) => {
    try {
      const { sub } = request.user as { sub: string };
      const body = adjustmentSchema.parse(request.body);
      const result = await svc.adjustStock(body, sub);
      await writeAuditLog(request, 'STOCK_ADJUSTMENT', 'InventoryItem', body.inventoryItemId, null, { qty: body.quantity });
      return reply.send(result);
    } catch (err) { return handleError(reply, err); }
  });

  fastify.post('/receive', {
    schema: { tags: ['Inventory'] },
    preHandler: [authenticate, requirePermission('inventory', 'create')],
  }, async (request, reply) => {
    try {
      const { companyId, sub } = request.user as { companyId: string; sub: string };
      const body = receiveStockSchema.parse(request.body);
      const result = await svc.receiveStock({ ...body, createdBy: sub }, companyId);
      return reply.status(201).send(result);
    } catch (err) { return handleError(reply, err); }
  });

  // ── Transactions ────────────────────────────────────────────────────────────

  fastify.get('/items/:id/transactions', {
    schema: { tags: ['Inventory'] },
    preHandler: [authenticate],
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(1000).default(100) }).parse(request.query);
      return await svc.getTransactionHistory(id, limit);
    } catch (err) { return handleError(reply, err); }
  });

  // ── MTRs ────────────────────────────────────────────────────────────────────

  fastify.get('/items/:id/mtrs', {
    schema: { tags: ['Inventory'] },
    preHandler: [authenticate],
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      return await svc.listMTRs(id);
    } catch (err) { return handleError(reply, err); }
  });

  fastify.post('/items/:id/mtrs', {
    schema: { tags: ['Inventory'] },
    preHandler: [authenticate, requirePermission('inventory', 'create')],
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const { sub } = request.user as { sub: string };
      const mtr = await svc.createMTR(id, request.body as Record<string, unknown>, sub);
      return reply.status(201).send(mtr);
    } catch (err) { return handleError(reply, err); }
  });

  // ── Valuation ───────────────────────────────────────────────────────────────

  fastify.get('/valuation', {
    schema: { tags: ['Inventory'] },
    preHandler: [authenticate, requirePermission('inventory', 'view')],
  }, async (request, reply) => {
    try {
      const { companyId, branchId } = request.user as { companyId: string; branchId?: string };
      const { branch } = z.object({ branch: z.string().uuid().optional() }).parse(request.query);
      return await svc.getValuationSummary(companyId, branch ?? branchId);
    } catch (err) { return handleError(reply, err); }
  });

  // ── Transfers ───────────────────────────────────────────────────────────────

  fastify.post('/transfers', {
    schema: { tags: ['Inventory'] },
    preHandler: [authenticate, requirePermission('inventory', 'create')],
  }, async (request, reply) => {
    try {
      const { sub } = request.user as { sub: string };
      const body = z.object({
        fromBranchId: z.string().uuid(),
        toBranchId: z.string().uuid(),
        notes: z.string().optional(),
        lines: z.array(z.object({
          inventoryItemId: z.string().uuid(),
          qtyRequested: z.number().positive(),
        })).min(1),
      }).parse(request.body);
      const transfer = await svc.createTransfer(body, sub);
      return reply.status(201).send(transfer);
    } catch (err) { return handleError(reply, err); }
  });

  // ── CSV Import: Products ─────────────────────────────────────────────────────

  fastify.post('/products/import', {
    schema: { tags: ['Inventory'] },
    preHandler: [authenticate, requirePermission('inventory', 'create')],
  }, async (request, reply) => {
    try {
      const { companyId, sub } = request.user as { companyId: string; sub: string };
      const data = await request.file();
      if (!data) return reply.status(400).send({ error: 'No file uploaded' });

      const buffer = await data.toBuffer();
      const text = buffer.toString('utf-8');
      const lines = text.trim().split(/\r?\n/).filter(Boolean);
      if (lines.length < 2) return reply.send({ created: 0, updated: 0, skipped: 0, errors: [] });

      function parseLine(line: string): string[] {
        const row: string[] = [];
        let inQ = false; let cur = '';
        for (const ch of line) {
          if (ch === '"') { inQ = !inQ; }
          else if (ch === ',' && !inQ) { row.push(cur.trim()); cur = ''; }
          else { cur += ch; }
        }
        row.push(cur.trim());
        return row;
      }

      const headers = parseLine(lines[0]).map((h) => h.toLowerCase().trim());
      const idx = (k: string) => headers.indexOf(k);

      let created = 0; let updated = 0; let skipped = 0;
      const errors: Array<{ row: number; message: string }> = [];

      const { prisma } = await import('../../config/database');

      for (let i = 1; i < lines.length; i++) {
        const cols = parseLine(lines[i]);
        const rowNum = i + 1;
        try {
          const code = cols[idx('code')]?.trim();
          const description = cols[idx('description')]?.trim();
          if (!code) { errors.push({ row: rowNum, message: 'Missing required field: code' }); skipped++; continue; }
          if (!description) { errors.push({ row: rowNum, message: 'Missing required field: description' }); skipped++; continue; }

          const uom = cols[idx('uom')]?.trim() || 'EA';
          const materialType = cols[idx('materialtype')]?.trim() || undefined;
          const grade = cols[idx('grade')]?.trim() || undefined;
          const shape = cols[idx('shape')]?.trim() || undefined;
          const stdCostRaw = cols[idx('standardcost')]?.trim();
          const listPriceRaw = cols[idx('listprice')]?.trim();
          const standardCost = stdCostRaw ? Math.round(parseFloat(stdCostRaw) * 100) : undefined;
          const listPrice = listPriceRaw ? Math.round(parseFloat(listPriceRaw) * 100) : undefined;
          const isBought = cols[idx('isbought')]?.toLowerCase() !== 'false';
          const isSold = cols[idx('issold')]?.toLowerCase() !== 'false';
          const isStocked = cols[idx('isstocked')]?.toLowerCase() !== 'false';
          const reorderPointRaw = cols[idx('reorderpoint')]?.trim();
          const reorderPoint = reorderPointRaw ? parseFloat(reorderPointRaw) : undefined;
          const trackByHeat = cols[idx('trackbyheat')]?.toLowerCase() === 'true';
          const requiresMtr = cols[idx('requiresmtr')]?.toLowerCase() === 'true';

          const existing = await prisma.product.findFirst({ where: { companyId, code, deletedAt: null } });

          if (existing) {
            await prisma.product.update({
              where: { id: existing.id },
              data: { description, uom, materialType, grade, shape, standardCost, listPrice, isBought, isSold, isStocked, reorderPoint, trackByHeat, requiresMtr, updatedBy: sub },
            });
            updated++;
          } else {
            await prisma.product.create({
              data: { companyId, code, description, uom, materialType, grade, shape, standardCost: standardCost ?? 0, listPrice: listPrice ?? 0, isBought, isSold, isStocked, reorderPoint, trackByHeat, requiresMtr, createdBy: sub, updatedBy: sub },
            });
            created++;
          }
        } catch (err: any) {
          errors.push({ row: rowNum, message: err?.message ?? 'Unknown error' });
          skipped++;
        }
      }

      return reply.send({ created, updated, skipped, errors });
    } catch (err) { return handleError(reply, err); }
  });

  // ── CSV Import: Inventory Levels ─────────────────────────────────────────────

  fastify.post('/items/import', {
    schema: { tags: ['Inventory'] },
    preHandler: [authenticate, requirePermission('inventory', 'create')],
  }, async (request, reply) => {
    try {
      const { companyId, sub } = request.user as { companyId: string; sub: string };
      const data = await request.file();
      if (!data) return reply.status(400).send({ error: 'No file uploaded' });

      const buffer = await data.toBuffer();
      const text = buffer.toString('utf-8');
      const lines = text.trim().split(/\r?\n/).filter(Boolean);
      if (lines.length < 2) return reply.send({ created: 0, updated: 0, skipped: 0, errors: [] });

      function parseLine(line: string): string[] {
        const row: string[] = [];
        let inQ = false; let cur = '';
        for (const ch of line) {
          if (ch === '"') { inQ = !inQ; }
          else if (ch === ',' && !inQ) { row.push(cur.trim()); cur = ''; }
          else { cur += ch; }
        }
        row.push(cur.trim());
        return row;
      }

      const headers = parseLine(lines[0]).map((h) => h.toLowerCase().trim());
      const idx = (k: string) => headers.indexOf(k);

      let created = 0; let updated = 0; let skipped = 0;
      const errors: Array<{ row: number; message: string }> = [];

      const { prisma } = await import('../../config/database');

      for (let i = 1; i < lines.length; i++) {
        const cols = parseLine(lines[i]);
        const rowNum = i + 1;
        try {
          const productCode = cols[idx('productcode')]?.trim();
          const locationCode = cols[idx('locationcode')]?.trim();
          const qtyStr = cols[idx('qtyonhand')]?.trim();
          const costStr = cols[idx('unitcostdollars')]?.trim();

          if (!productCode) { errors.push({ row: rowNum, message: 'Missing: productCode' }); skipped++; continue; }
          if (!locationCode) { errors.push({ row: rowNum, message: 'Missing: locationCode' }); skipped++; continue; }
          if (!qtyStr || isNaN(parseFloat(qtyStr))) { errors.push({ row: rowNum, message: 'Invalid: qtyOnHand' }); skipped++; continue; }
          if (!costStr || isNaN(parseFloat(costStr))) { errors.push({ row: rowNum, message: 'Invalid: unitCostDollars' }); skipped++; continue; }

          const product = await prisma.product.findFirst({ where: { companyId, code: productCode, deletedAt: null } });
          if (!product) { errors.push({ row: rowNum, message: `Product '${productCode}' not found` }); skipped++; continue; }

          const location = await prisma.inventoryLocation.findFirst({ where: { branchId: { in: (await prisma.branch.findMany({ where: { companyId } })).map((b) => b.id) }, code: locationCode } });
          if (!location) { errors.push({ row: rowNum, message: `Location '${locationCode}' not found` }); skipped++; continue; }

          const qtyOnHand = parseFloat(qtyStr);
          const unitCost = Math.round(parseFloat(costStr) * 100);
          const heatNumber = cols[idx('heatnumber')]?.trim() || undefined;
          const certNumber = cols[idx('certnumber')]?.trim() || undefined;
          const lotNumber = cols[idx('lotnumber')]?.trim() || undefined;
          const thickness = cols[idx('thickness')] ? parseInt(cols[idx('thickness')]) || undefined : undefined;
          const width = cols[idx('width')] ? parseInt(cols[idx('width')]) || undefined : undefined;
          const length = cols[idx('length')] ? parseInt(cols[idx('length')]) || undefined : undefined;

          const existing = await prisma.inventoryItem.findFirst({
            where: { productId: product.id, locationId: location.id, deletedAt: null },
          });

          if (existing) {
            const prevQty = Number(existing.qtyOnHand);
            const newQty = qtyOnHand;
            await prisma.$transaction([
              prisma.inventoryItem.update({
                where: { id: existing.id },
                data: { qtyOnHand: newQty, unitCost, totalCost: newQty * unitCost, version: { increment: 1 } },
              }),
              prisma.stockTransaction.create({
                data: {
                  inventoryItemId: existing.id,
                  transactionType: 'ADJUSTMENT',
                  quantity: newQty - prevQty,
                  unitCost,
                  totalCost: Math.abs(newQty - prevQty) * unitCost,
                  qtyBefore: prevQty,
                  qtyAfter: newQty,
                  notes: 'Opening balance import',
                  createdBy: sub,
                },
              }),
            ]);
            updated++;
          } else {
            const item = await prisma.inventoryItem.create({
              data: { productId: product.id, locationId: location.id, qtyOnHand, unitCost, totalCost: qtyOnHand * unitCost, heatNumber, certificateNumber: certNumber, lotNumber, thickness, width, length },
            });
            await prisma.stockTransaction.create({
              data: {
                inventoryItemId: item.id,
                transactionType: 'OPENING',
                quantity: qtyOnHand,
                unitCost,
                totalCost: qtyOnHand * unitCost,
                qtyBefore: 0,
                qtyAfter: qtyOnHand,
                notes: 'Opening balance import',
                createdBy: sub,
              },
            });
            created++;
          }
        } catch (err: any) {
          errors.push({ row: rowNum, message: err?.message ?? 'Unknown error' });
          skipped++;
        }
      }

      return reply.send({ created, updated, skipped, errors });
    } catch (err) { return handleError(reply, err); }
  });

  // ── Inventory Dashboard ──────────────────────────────────────────────────────
  // Returns per-product aggregated qty + value for dashboard charts.

  fastify.get('/dashboard', {
    schema: { tags: ['Inventory'] },
    preHandler: [authenticate],
  }, async (request, reply) => {
    try {
      const { companyId } = request.user as { companyId: string };

      // Aggregate by product
      const grouped = await prisma.inventoryItem.groupBy({
        by: ['productId'],
        where: { deletedAt: null, isActive: true, product: { companyId } },
        _sum: { totalCost: true, qtyOnHand: true },
      });

      // Fetch product details for the aggregated product IDs
      const productIds = grouped.map((g) => g.productId);
      const products = await prisma.product.findMany({
        where: { id: { in: productIds }, deletedAt: null },
        select: { id: true, code: true, description: true, uom: true, category: { select: { name: true } } },
      });
      const productMap = Object.fromEntries(products.map((p) => [p.id, p]));

      const items = grouped
        .map((g) => ({
          productId:   g.productId,
          code:        productMap[g.productId]?.code ?? g.productId,
          description: productMap[g.productId]?.description ?? '',
          uom:         productMap[g.productId]?.uom ?? '',
          category:    productMap[g.productId]?.category?.name ?? 'Uncategorised',
          qtyOnHand:   Number(g._sum.qtyOnHand ?? 0),
          totalValue:  Number(g._sum.totalCost ?? 0),
        }))
        .sort((a, b) => b.totalValue - a.totalValue);

      const grandTotal      = items.reduce((s, i) => s + i.totalValue, 0);
      const totalQty        = items.reduce((s, i) => s + i.qtyOnHand, 0);
      const productCount    = items.length;

      // Category breakdown
      const byCat: Record<string, { category: string; value: number; qty: number }> = {};
      for (const item of items) {
        const k = item.category;
        byCat[k] = byCat[k] ?? { category: k, value: 0, qty: 0 };
        byCat[k].value += item.totalValue;
        byCat[k].qty   += item.qtyOnHand;
      }

      return reply.send({
        data: {
          grandTotal,
          totalQty,
          productCount,
          items,
          byCategory: Object.values(byCat).sort((a, b) => b.value - a.value),
        },
      });
    } catch (err) { return handleError(reply, err); }
  });

  // ── Adjustments audit log ────────────────────────────────────────────────────
  // Returns all ADJUSTMENT-type stock transactions across the company, with
  // product and user info so supervisors can see every manual change.

  fastify.get('/adjustments', {
    schema: { tags: ['Inventory'] },
    preHandler: [authenticate, requirePermission('inventory', 'view')],
  }, async (request, reply) => {
    try {
      const { companyId } = request.user as { companyId: string };
      const { limit: lim, offset: off } = z.object({
        limit:  z.coerce.number().int().min(1).max(500).default(100),
        offset: z.coerce.number().int().min(0).default(0),
      }).parse(request.query);

      const [txns, total] = await Promise.all([
        prisma.stockTransaction.findMany({
          where: {
            transactionType: 'ADJUSTMENT',
            inventoryItem: { product: { companyId } },
          },
          orderBy: { createdAt: 'desc' },
          take: lim,
          skip: off,
          include: {
            inventoryItem: {
              select: {
                id: true,
                heatNumber: true,
                lotNumber: true,
                product: { select: { id: true, code: true, description: true, uom: true } },
                location: { select: { code: true, name: true } },
              },
            },
          },
        }),
        prisma.stockTransaction.count({
          where: {
            transactionType: 'ADJUSTMENT',
            inventoryItem: { product: { companyId } },
          },
        }),
      ]);

      return reply.send({
        data: txns.map((t) => ({
          id:          t.id,
          createdAt:   t.createdAt,
          createdBy:   t.createdBy,
          quantity:    Number(t.quantity),
          qtyBefore:   Number(t.qtyBefore),
          qtyAfter:    Number(t.qtyAfter),
          unitCost:    Number(t.unitCost),
          notes:       t.notes,
          product:     t.inventoryItem.product,
          location:    t.inventoryItem.location,
          heatNumber:  t.inventoryItem.heatNumber,
          lotNumber:   t.inventoryItem.lotNumber,
        })),
        meta: { total, limit: lim, offset: off },
      });
    } catch (err) { return handleError(reply, err); }
  });

  // ── Document Uploads ──────────────────────────────────────────────────────────

  fastify.post('/documents', { preHandler: [authenticate, requirePermission('inventory', 'create')] }, async (request, reply) => {
    try {
      const { companyId, sub } = request.user as { companyId: string; sub: string };
      const data = await request.file();
      if (!data) return reply.status(400).send({ message: 'No file uploaded' });

      const body = data.fields as any;
      const sourceType = (body.sourceType?.value ?? body.sourceType ?? 'PO_RECEIPT') as string;
      const sourceId   = (body.sourceId?.value   ?? body.sourceId   ?? '') as string;

      const buffer = await data.toBuffer();
      const ext = path.extname(data.filename) || '';
      const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
      const uploadDir = '/uploads/documents';
      fs.mkdirSync(uploadDir, { recursive: true });
      fs.writeFileSync(path.join(uploadDir, fileName), buffer);

      const fileUrl = `/api/inventory/documents/${fileName}`;
      const doc = await (prisma as any).documentAttachment.create({
        data: {
          companyId,
          sourceType,
          sourceId: sourceId || null,
          fileName: data.filename,
          fileUrl,
          fileSize: buffer.length,
          mimeType: data.mimetype,
          uploadedBy: sub,
        },
      });

      return reply.status(201).send({ id: doc.id, fileName: doc.fileName, fileUrl: doc.fileUrl });
    } catch (err) { return handleError(reply, err); }
  });

  fastify.get('/documents/:filename', { preHandler: [authenticate] }, async (request, reply) => {
    const { filename } = request.params as { filename: string };
    const filePath = path.join('/uploads/documents', path.basename(filename));
    if (!fs.existsSync(filePath)) return reply.status(404).send({ message: 'File not found' });
    const stream = fs.createReadStream(filePath);
    return reply.send(stream);
  });
};
