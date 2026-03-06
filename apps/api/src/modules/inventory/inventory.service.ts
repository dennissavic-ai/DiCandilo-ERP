import { Prisma, TransactionType, CostMethod } from '@prisma/client';
import { prisma } from '../../config/database';
import {
  NotFoundError,
  ConflictError,
  ValidationError,
  OptimisticLockError,
} from '../../utils/errors';
import { parsePagination, paginatedResponse } from '../../utils/pagination';
import { emitInventoryUpdate } from '../../websocket/ws.plugin';

// ─── DTOs ─────────────────────────────────────────────────────────────────────

export interface CreateProductDTO {
  categoryId?: string;
  code: string;
  description: string;
  longDescription?: string;
  uom: string;
  materialType?: string;
  grade?: string;
  alloy?: string;
  shape?: string;
  finish?: string;
  coating?: string;
  standardLength?: number;
  standardWidth?: number;
  standardThickness?: number;
  weightPerMeter?: number;
  costMethod?: CostMethod;
  standardCost?: number;
  listPrice?: number;
  reorderPoint?: number;
  reorderQty?: number;
  isBought?: boolean;
  isSold?: boolean;
  isStocked?: boolean;
  trackByHeat?: boolean;
  requiresMtr?: boolean;
}

export interface CreateInventoryItemDTO {
  productId: string;
  locationId: string;
  lotNumber?: string;
  heatNumber?: string;
  certificateNumber?: string;
  thickness?: number;
  width?: number;
  length?: number;
  weightGrams?: number;
  qtyOnHand: number;
  unitCost: number; // cents
}

export interface StockAdjustmentDTO {
  inventoryItemId: string;
  quantity: number; // positive = add, negative = remove
  reason: string;
  notes?: string;
  expectedVersion: number;
}

export interface StockTransferDTO {
  fromBranchId: string;
  toBranchId: string;
  lines: Array<{
    inventoryItemId: string;
    qtyRequested: number;
  }>;
  notes?: string;
}

export interface ReceiveStockDTO {
  purchaseOrderId?: string;
  locationId: string;
  lines: Array<{
    productId: string;
    qtyReceived: number;
    unitCost: number; // cents
    heatNumber?: string;
    certNumber?: string;
    thickness?: number;
    width?: number;
    length?: number;
    weightGrams?: number;
  }>;
  notes?: string;
  createdBy: string;
}

export interface ListInventoryQuery {
  page?: number;
  limit?: number;
  search?: string;
  locationId?: string;
  productId?: string;
  branchId?: string;
  isRemnant?: boolean;
  lowStock?: boolean;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

// ─── SERVICE ──────────────────────────────────────────────────────────────────

export class InventoryService {

  // ── Products ──

  async listProducts(companyId: string, query: ListInventoryQuery) {
    const { skip, take, page, limit } = parsePagination(query);

    const where: Prisma.ProductWhereInput = {
      companyId,
      deletedAt: null,
      isActive: true,
      ...(query.search && {
        OR: [
          { code: { contains: query.search, mode: 'insensitive' } },
          { description: { contains: query.search, mode: 'insensitive' } },
          { grade: { contains: query.search, mode: 'insensitive' } },
        ],
      }),
    };

    const [data, total] = await Promise.all([
      prisma.product.findMany({
        where,
        skip,
        take,
        orderBy: { [query.sortBy ?? 'code']: query.sortOrder ?? 'asc' },
        include: {
          category: { select: { id: true, name: true, code: true } },
          _count: { select: { inventoryItems: true } },
        },
      }),
      prisma.product.count({ where }),
    ]);

    return paginatedResponse(data, total, page, limit);
  }

  async getProduct(companyId: string, id: string) {
    const product = await prisma.product.findFirst({
      where: { id, companyId, deletedAt: null },
      include: {
        category: true,
        inventoryItems: {
          where: { deletedAt: null, isActive: true },
          include: { location: { select: { id: true, code: true, name: true } } },
        },
      },
    });
    if (!product) throw new NotFoundError('Product', id);
    return product;
  }

  async createProduct(companyId: string, dto: CreateProductDTO, userId: string) {
    const existing = await prisma.product.findFirst({
      where: { companyId, code: dto.code, deletedAt: null },
    });
    if (existing) throw new ConflictError(`Product code '${dto.code}' already exists`);

    return prisma.product.create({
      data: {
        companyId,
        ...dto,
        standardCost: dto.standardCost ?? 0,
        listPrice: dto.listPrice ?? 0,
        createdBy: userId,
        updatedBy: userId,
      },
    });
  }

  async updateProduct(companyId: string, id: string, dto: Partial<CreateProductDTO>, userId: string) {
    await this.getProduct(companyId, id);
    return prisma.product.update({
      where: { id },
      data: { ...dto, updatedBy: userId },
    });
  }

  async deleteProduct(companyId: string, id: string, userId: string) {
    const product = await this.getProduct(companyId, id);
    const hasStock = await prisma.inventoryItem.findFirst({
      where: { productId: id, deletedAt: null, qtyOnHand: { gt: 0 } },
    });
    if (hasStock) throw new ValidationError('Cannot delete product with stock on hand');

    return prisma.product.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false, updatedBy: userId },
    });
  }

  // ── Locations ──

  async listLocations(branchId: string) {
    return prisma.inventoryLocation.findMany({
      where: { branchId, deletedAt: null, isActive: true },
      orderBy: { code: 'asc' },
    });
  }

  async createLocation(branchId: string, data: { code: string; name: string; type?: string }, userId: string) {
    const existing = await prisma.inventoryLocation.findFirst({
      where: { branchId, code: data.code, deletedAt: null },
    });
    if (existing) throw new ConflictError(`Location code '${data.code}' already exists`);

    return prisma.inventoryLocation.create({
      data: {
        branchId,
        code: data.code,
        name: data.name,
        type: (data.type as 'STORAGE' | 'RECEIVING' | 'SHIPPING' | 'QUARANTINE' | 'SCRAP' | 'WIP') ?? 'STORAGE',
        createdBy: userId,
        updatedBy: userId,
      },
    });
  }

  // ── Inventory Items ──

  async listInventoryItems(companyId: string, query: ListInventoryQuery) {
    const { skip, take, page, limit } = parsePagination(query);

    const where: Prisma.InventoryItemWhereInput = {
      deletedAt: null,
      isActive: true,
      product: { companyId },
      ...(query.locationId && { locationId: query.locationId }),
      ...(query.productId && { productId: query.productId }),
      ...(query.isRemnant !== undefined && { isRemnant: query.isRemnant }),
      ...(query.search && {
        OR: [
          { heatNumber: { contains: query.search, mode: 'insensitive' } },
          { lotNumber: { contains: query.search, mode: 'insensitive' } },
          { product: { description: { contains: query.search, mode: 'insensitive' } } },
          { product: { code: { contains: query.search, mode: 'insensitive' } } },
        ],
      }),
    };

    // Low stock filter
    if (query.lowStock) {
      where.AND = [
        { product: { reorderPoint: { not: null } } },
        { qtyAvailable: { lte: prisma.inventoryItem.fields.qtyAvailable } },
      ];
    }

    const [data, total] = await Promise.all([
      prisma.inventoryItem.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: query.sortOrder ?? 'desc' },
        include: {
          product: {
            select: {
              id: true, code: true, description: true, uom: true,
              grade: true, alloy: true, shape: true, reorderPoint: true,
            },
          },
          location: { select: { id: true, code: true, name: true } },
          _count: { select: { mtrs: true } },
        },
      }),
      prisma.inventoryItem.count({ where }),
    ]);

    return paginatedResponse(data, total, page, limit);
  }

  async getInventoryItem(id: string) {
    const item = await prisma.inventoryItem.findFirst({
      where: { id, deletedAt: null },
      include: {
        product: true,
        location: true,
        transactions: { orderBy: { createdAt: 'desc' }, take: 50 },
        mtrs: { orderBy: { createdAt: 'desc' } },
        barcodes: true,
      },
    });
    if (!item) throw new NotFoundError('InventoryItem', id);
    return item;
  }

  async createInventoryItem(dto: CreateInventoryItemDTO, userId: string) {
    return prisma.$transaction(async (tx) => {
      const item = await tx.inventoryItem.create({
        data: {
          productId: dto.productId,
          locationId: dto.locationId,
          lotNumber: dto.lotNumber,
          heatNumber: dto.heatNumber,
          certificateNumber: dto.certificateNumber,
          thickness: dto.thickness,
          width: dto.width,
          length: dto.length,
          weightGrams: dto.weightGrams,
          qtyOnHand: dto.qtyOnHand,
          qtyAvailable: dto.qtyOnHand,
          unitCost: dto.unitCost,
          totalCost: BigInt(Math.round(dto.qtyOnHand * dto.unitCost)),
          createdBy: userId,
          updatedBy: userId,
        },
      });

      // Record opening balance transaction
      await tx.stockTransaction.create({
        data: {
          inventoryItemId: item.id,
          transactionType: TransactionType.OPENING,
          quantity: dto.qtyOnHand,
          unitCost: dto.unitCost,
          totalCost: BigInt(Math.round(dto.qtyOnHand * dto.unitCost)),
          qtyBefore: 0,
          qtyAfter: dto.qtyOnHand,
          notes: 'Opening balance',
          createdBy: userId,
        },
      });

      emitInventoryUpdate({ type: 'ITEM_CREATED', itemId: item.id });
      return item;
    });
  }

  /**
   * Adjust stock up or down with optimistic locking.
   */
  async adjustStock(dto: StockAdjustmentDTO, userId: string) {
    return prisma.$transaction(async (tx) => {
      // Fetch with version check (optimistic lock)
      const item = await tx.inventoryItem.findFirst({
        where: { id: dto.inventoryItemId, deletedAt: null },
      });

      if (!item) throw new NotFoundError('InventoryItem', dto.inventoryItemId);
      if (item.version !== dto.expectedVersion) throw new OptimisticLockError();

      const qtyBefore = Number(item.qtyOnHand);
      const qtyAfter = qtyBefore + dto.quantity;

      if (qtyAfter < 0) {
        throw new ValidationError(`Adjustment would result in negative stock (${qtyAfter})`);
      }

      const updated = await tx.inventoryItem.update({
        where: { id: dto.inventoryItemId, version: dto.expectedVersion },
        data: {
          qtyOnHand: qtyAfter,
          qtyAvailable: { increment: dto.quantity },
          totalCost: BigInt(Math.round(qtyAfter * Number(item.unitCost))),
          version: { increment: 1 },
          updatedBy: userId,
        },
      });

      // Prisma optimistic lock: if version mismatch, update returns 0 rows
      if (!updated) throw new OptimisticLockError();

      await tx.stockTransaction.create({
        data: {
          inventoryItemId: dto.inventoryItemId,
          transactionType: TransactionType.ADJUSTMENT,
          quantity: dto.quantity,
          unitCost: item.unitCost,
          totalCost: BigInt(Math.round(dto.quantity * Number(item.unitCost))),
          qtyBefore,
          qtyAfter,
          notes: `${dto.reason}${dto.notes ? ': ' + dto.notes : ''}`,
          createdBy: userId,
        },
      });

      emitInventoryUpdate({ type: 'STOCK_ADJUSTED', itemId: dto.inventoryItemId, qtyAfter });
      return updated;
    });
  }

  /**
   * Receive material into inventory (from PO receipt or direct).
   */
  async receiveStock(dto: ReceiveStockDTO, companyId: string) {
    return prisma.$transaction(async (tx) => {
      const createdItems: string[] = [];

      for (const line of dto.lines) {
        const product = await tx.product.findFirst({
          where: { id: line.productId, companyId, deletedAt: null },
        });
        if (!product) throw new NotFoundError('Product', line.productId);

        // Check if existing lot/heat already in location
        const existingItem = await tx.inventoryItem.findFirst({
          where: {
            productId: line.productId,
            locationId: dto.locationId,
            heatNumber: line.heatNumber ?? null,
            deletedAt: null,
          },
        });

        let inventoryItemId: string;

        if (existingItem && product.costMethod === CostMethod.AVERAGE) {
          // Average cost update
          const newTotalQty = Number(existingItem.qtyOnHand) + line.qtyReceived;
          const newTotalCost =
            Number(existingItem.totalCost) + line.qtyReceived * line.unitCost;
          const newAvgCost = Math.round(newTotalCost / newTotalQty);

          await tx.inventoryItem.update({
            where: { id: existingItem.id },
            data: {
              qtyOnHand: newTotalQty,
              qtyAvailable: { increment: line.qtyReceived },
              unitCost: newAvgCost,
              totalCost: BigInt(Math.round(newTotalCost)),
              version: { increment: 1 },
              updatedBy: dto.createdBy,
            },
          });
          inventoryItemId = existingItem.id;
        } else {
          // Create new inventory item (FIFO or new heat)
          const newItem = await tx.inventoryItem.create({
            data: {
              productId: line.productId,
              locationId: dto.locationId,
              heatNumber: line.heatNumber,
              certificateNumber: line.certNumber,
              thickness: line.thickness,
              width: line.width,
              length: line.length,
              weightGrams: line.weightGrams,
              qtyOnHand: line.qtyReceived,
              qtyAvailable: line.qtyReceived,
              unitCost: line.unitCost,
              totalCost: BigInt(Math.round(line.qtyReceived * line.unitCost)),
              createdBy: dto.createdBy,
              updatedBy: dto.createdBy,
            },
          });
          inventoryItemId = newItem.id;
          createdItems.push(inventoryItemId);
        }

        const qtyBefore = existingItem ? Number(existingItem.qtyOnHand) : 0;
        await tx.stockTransaction.create({
          data: {
            inventoryItemId,
            transactionType: TransactionType.RECEIPT,
            referenceType: dto.purchaseOrderId ? 'PO' : 'DIRECT',
            referenceId: dto.purchaseOrderId,
            quantity: line.qtyReceived,
            unitCost: line.unitCost,
            totalCost: BigInt(Math.round(line.qtyReceived * line.unitCost)),
            qtyBefore,
            qtyAfter: qtyBefore + line.qtyReceived,
            notes: dto.notes,
            createdBy: dto.createdBy,
          },
        });
      }

      createdItems.forEach((id) => emitInventoryUpdate({ type: 'STOCK_RECEIVED', itemId: id }));
      return { message: 'Stock received successfully', itemsCreated: createdItems.length };
    });
  }

  /**
   * Allocate stock to a sales order line (reduces qtyAvailable).
   */
  async allocateStock(
    inventoryItemId: string,
    qty: number,
    salesOrderLineId: string,
    userId: string
  ) {
    return prisma.$transaction(async (tx) => {
      const item = await tx.inventoryItem.findUnique({ where: { id: inventoryItemId } });
      if (!item) throw new NotFoundError('InventoryItem', inventoryItemId);

      if (Number(item.qtyAvailable) < qty) {
        throw new ValidationError(`Insufficient available quantity. Available: ${item.qtyAvailable}, Requested: ${qty}`);
      }

      await tx.inventoryItem.update({
        where: { id: inventoryItemId },
        data: {
          qtyAllocated: { increment: qty },
          qtyAvailable: { decrement: qty },
          version: { increment: 1 },
          updatedBy: userId,
        },
      });

      emitInventoryUpdate({ type: 'STOCK_ALLOCATED', itemId: inventoryItemId, qty });
      return { success: true };
    });
  }

  /**
   * Issue stock from inventory (pick/ship). Reduces qtyOnHand.
   */
  async issueStock(
    inventoryItemId: string,
    qty: number,
    referenceType: string,
    referenceId: string,
    userId: string
  ) {
    return prisma.$transaction(async (tx) => {
      const item = await tx.inventoryItem.findUnique({ where: { id: inventoryItemId } });
      if (!item) throw new NotFoundError('InventoryItem', inventoryItemId);

      if (Number(item.qtyOnHand) < qty) {
        throw new ValidationError('Insufficient stock on hand');
      }

      const qtyBefore = Number(item.qtyOnHand);
      const qtyAfter = qtyBefore - qty;

      await tx.inventoryItem.update({
        where: { id: inventoryItemId },
        data: {
          qtyOnHand: qtyAfter,
          qtyAllocated: { decrement: qty },
          totalCost: BigInt(Math.round(qtyAfter * Number(item.unitCost))),
          version: { increment: 1 },
          updatedBy: userId,
        },
      });

      await tx.stockTransaction.create({
        data: {
          inventoryItemId,
          transactionType: TransactionType.ISSUE,
          referenceType,
          referenceId,
          quantity: -qty,
          unitCost: item.unitCost,
          totalCost: BigInt(Math.round(qty * Number(item.unitCost))),
          qtyBefore,
          qtyAfter,
          createdBy: userId,
        },
      });

      emitInventoryUpdate({ type: 'STOCK_ISSUED', itemId: inventoryItemId, qtyAfter });
      return { success: true };
    });
  }

  /**
   * Create an inter-branch transfer.
   */
  async createTransfer(dto: StockTransferDTO, userId: string) {
    return prisma.stockTransfer.create({
      data: {
        fromBranchId: dto.fromBranchId,
        toBranchId: dto.toBranchId,
        notes: dto.notes,
        createdBy: userId,
        lines: {
          create: dto.lines.map((l) => ({
            inventoryItemId: l.inventoryItemId,
            qtyRequested: l.qtyRequested,
          })),
        },
      },
      include: { lines: true },
    });
  }

  // ── MTR ──

  async listMTRs(inventoryItemId: string) {
    return prisma.materialTestReport.findMany({
      where: { inventoryItemId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createMTR(inventoryItemId: string, data: Record<string, unknown>, userId: string) {
    const { inventoryItemId: _ignored, ...rest } = data as Prisma.MaterialTestReportUncheckedCreateInput;
    return prisma.materialTestReport.create({
      data: {
        inventoryItemId,
        ...rest,
        createdBy: userId,
      },
    });
  }

  // ── Valuation ──

  async getValuationSummary(companyId: string, branchId?: string) {
    const result = await prisma.inventoryItem.groupBy({
      by: ['productId'],
      where: {
        deletedAt: null,
        isActive: true,
        product: { companyId },
        ...(branchId && { location: { branchId } }),
      },
      _sum: { totalCost: true, qtyOnHand: true },
      _count: { id: true },
    });

    const grandTotal = result.reduce(
      (acc, r) => acc + Number(r._sum.totalCost ?? 0),
      0
    );

    return {
      lineItems: result.length,
      grandTotal,
      items: result,
    };
  }

  // ── Stock Transactions ──

  async getTransactionHistory(inventoryItemId: string, limit = 100) {
    return prisma.stockTransaction.findMany({
      where: { inventoryItemId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  // ── Categories ──

  async listCategories(companyId: string) {
    return prisma.productCategory.findMany({
      where: { companyId, deletedAt: null },
      orderBy: { code: 'asc' },
      include: { children: { where: { deletedAt: null } } },
    });
  }

  async createCategory(companyId: string, data: { code: string; name: string; parentId?: string }, userId: string) {
    return prisma.productCategory.create({
      data: { companyId, ...data },
    });
  }
}
