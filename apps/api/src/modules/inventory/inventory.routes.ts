import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
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
};
