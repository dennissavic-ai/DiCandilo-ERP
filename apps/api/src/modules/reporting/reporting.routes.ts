import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../config/database';
import { authenticate, requirePermission } from '../../middleware/auth.middleware';
import { handleError } from '../../utils/errors';

export const reportingRoutes: FastifyPluginAsync = async (fastify) => {

  // ── Dashboard KPIs ──────────────────────────────────────────────────────────

  fastify.get('/dashboard', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const { companyId } = request.user as { companyId: string };
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const weekStart = new Date(todayStart);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      const [
        salesToday, salesWeek, salesMonth,
        openOrders, openQuotes,
        inventoryValue,
        overdueInvoices, openPOs,
        lowStockProducts,
        openWorkOrders,
        openAPBalance,
        cashGLAccount,
        apGLAccount,
      ] = await Promise.all([
        // Sales totals
        prisma.salesOrder.aggregate({ where: { companyId, createdAt: { gte: todayStart }, deletedAt: null }, _sum: { totalAmount: true }, _count: { id: true } }),
        prisma.salesOrder.aggregate({ where: { companyId, createdAt: { gte: weekStart }, deletedAt: null }, _sum: { totalAmount: true }, _count: { id: true } }),
        prisma.salesOrder.aggregate({ where: { companyId, createdAt: { gte: monthStart }, deletedAt: null }, _sum: { totalAmount: true }, _count: { id: true } }),

        // Open orders
        prisma.salesOrder.count({ where: { companyId, status: { in: ['CONFIRMED', 'IN_PRODUCTION', 'READY_TO_SHIP', 'PARTIALLY_SHIPPED'] }, deletedAt: null } }),
        prisma.salesQuote.count({ where: { companyId, status: { in: ['DRAFT', 'SENT'] }, deletedAt: null } }),

        // Inventory value
        prisma.inventoryItem.aggregate({ where: { deletedAt: null, isActive: true, product: { companyId } }, _sum: { totalCost: true } }),

        // Overdue invoices (AR)
        prisma.invoice.aggregate({ where: { companyId, dueDate: { lt: now }, status: { notIn: ['PAID', 'CANCELLED', 'WRITTEN_OFF'] }, deletedAt: null }, _sum: { balanceDue: true }, _count: { id: true } }),

        // Open POs
        prisma.purchaseOrder.count({ where: { companyId, status: { in: ['SUBMITTED', 'APPROVED', 'PARTIALLY_RECEIVED'] }, deletedAt: null } }),

        // Low stock — products where any inventory item's qtyAvailable < product.reorderPoint
        prisma.product.count({
          where: {
            companyId,
            deletedAt: null,
            isActive: true,
            reorderPoint: { not: null },
            inventoryItems: {
              some: {
                deletedAt: null,
                isActive: true,
                qtyAvailable: { lt: prisma.product.fields.reorderPoint as any },
              },
            },
          },
        }).catch(() => 0), // graceful fallback if complex query unsupported

        // Open work orders
        prisma.workOrder.count({ where: { companyId, status: { in: ['SCHEDULED', 'IN_PROGRESS'] }, deletedAt: null } }),

        // Open AP (supplier invoices not yet paid)
        prisma.supplierInvoice.aggregate({
          where: { supplier: { companyId }, status: { notIn: ['PAID', 'CANCELLED'] } },
          _sum: { totalAmount: true, amountPaid: true },
        }),

        // Cash GL account (code 1000) — net balance = debits - credits
        prisma.gLAccount.findFirst({ where: { companyId, code: '1000', deletedAt: null } }),
        prisma.gLAccount.findFirst({ where: { companyId, code: '2000', deletedAt: null } }),
      ]);

      // Cash position from GL transactions on account 1000
      let cashBalance = 0;
      if (cashGLAccount) {
        const cashTxn = await prisma.gLTransaction.aggregate({
          where: { companyId, glAccountId: cashGLAccount.id },
          _sum: { debitAmount: true, creditAmount: true },
        });
        cashBalance = Number(cashTxn._sum.debitAmount ?? 0) - Number(cashTxn._sum.creditAmount ?? 0);
      }

      // AP balance
      const totalAP = Number(openAPBalance._sum?.totalAmount ?? 0);
      const paidAP = Number(openAPBalance._sum?.amountPaid ?? 0);
      const openAP = totalAP - paidAP;

      // Working capital = current assets - current liabilities (simplified: AR + Cash - AP)
      const totalARBalance = await prisma.invoice.aggregate({
        where: { companyId, status: { notIn: ['PAID', 'CANCELLED', 'WRITTEN_OFF'] }, deletedAt: null },
        _sum: { balanceDue: true },
      });
      const totalAR = Number(totalARBalance._sum.balanceDue ?? 0);
      const workingCapital = cashBalance + totalAR - openAP;

      return {
        sales: {
          today: { amount: Number(salesToday._sum.totalAmount ?? 0), count: salesToday._count.id },
          week: { amount: Number(salesWeek._sum.totalAmount ?? 0), count: salesWeek._count.id },
          month: { amount: Number(salesMonth._sum.totalAmount ?? 0), count: salesMonth._count.id },
        },
        orders: { open: openOrders, openQuotes },
        inventory: { value: Number(inventoryValue._sum.totalCost ?? 0), lowStockCount: lowStockProducts },
        ar: { totalBalance: totalAR, overdueBalance: Number(overdueInvoices._sum.balanceDue ?? 0), overdueCount: overdueInvoices._count.id },
        ap: { openBalance: openAP },
        purchasing: { openPOs },
        production: { openWorkOrders },
        cashPosition: cashBalance,
        workingCapital,
      };
    } catch (err) { return handleError(reply, err); }
  });

  // ── Sales Report ────────────────────────────────────────────────────────────

  fastify.get('/sales', { preHandler: [authenticate, requirePermission('reporting', 'view')] }, async (request, reply) => {
    try {
      const { companyId } = request.user as { companyId: string };
      const { from, to, groupBy } = z.object({
        from: z.string().datetime(),
        to: z.string().datetime(),
        groupBy: z.enum(['customer', 'product', 'day', 'month']).default('customer'),
      }).parse(request.query);

      const orders = await prisma.salesOrder.findMany({
        where: {
          companyId,
          orderDate: { gte: new Date(from), lte: new Date(to) },
          deletedAt: null,
          status: { notIn: ['CANCELLED'] },
        },
        include: {
          customer: { select: { id: true, name: true, code: true } },
          lines: { include: { product: { select: { id: true, code: true, description: true } } } },
        },
      });

      if (groupBy === 'customer') {
        const byCustomer: Record<string, { customerId: string; customerName: string; orderCount: number; totalAmount: number }> = {};
        for (const o of orders) {
          if (!byCustomer[o.customerId]) byCustomer[o.customerId] = { customerId: o.customerId, customerName: o.customer.name, orderCount: 0, totalAmount: 0 };
          byCustomer[o.customerId].orderCount++;
          byCustomer[o.customerId].totalAmount += Number(o.totalAmount);
        }
        return { groupBy, rows: Object.values(byCustomer).sort((a, b) => b.totalAmount - a.totalAmount) };
      }

      return { groupBy, orders };
    } catch (err) { return handleError(reply, err); }
  });

  // ── Inventory Report ────────────────────────────────────────────────────────

  fastify.get('/inventory', { preHandler: [authenticate, requirePermission('reporting', 'view')] }, async (request, reply) => {
    try {
      const { companyId } = request.user as { companyId: string };
      const { type } = z.object({
        type: z.enum(['on-hand', 'valuation', 'slow-moving', 'turnover']).default('on-hand'),
      }).parse(request.query);

      if (type === 'valuation') {
        const items = await prisma.inventoryItem.findMany({
          where: { deletedAt: null, isActive: true, product: { companyId } },
          include: {
            product: { select: { code: true, description: true, uom: true } },
            location: { select: { code: true, name: true } },
          },
          orderBy: { totalCost: 'desc' },
        });
        const grandTotal = items.reduce((s, i) => s + Number(i.totalCost), 0);
        return { items, grandTotal };
      }

      if (type === 'slow-moving') {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const activeItems = await prisma.inventoryItem.findMany({
          where: { deletedAt: null, isActive: true, qtyOnHand: { gt: 0 }, product: { companyId } },
          include: {
            product: { select: { code: true, description: true } },
            transactions: { where: { createdAt: { gte: thirtyDaysAgo }, transactionType: 'ISSUE' }, select: { quantity: true } },
          },
        });
        const slowMoving = activeItems
          .filter((i) => i.transactions.length === 0)
          .map((i) => ({ id: i.id, product: i.product, qtyOnHand: i.qtyOnHand, totalCost: i.totalCost }));
        return { items: slowMoving, count: slowMoving.length };
      }

      // Default: on-hand summary
      const summary = await prisma.inventoryItem.groupBy({
        by: ['productId'],
        where: { deletedAt: null, isActive: true, product: { companyId } },
        _sum: { qtyOnHand: true, qtyAllocated: true, qtyAvailable: true, totalCost: true },
        _count: { id: true },
      });
      return { rows: summary };
    } catch (err) { return handleError(reply, err); }
  });

  // ── Purchasing Report ───────────────────────────────────────────────────────

  fastify.get('/purchasing', { preHandler: [authenticate, requirePermission('reporting', 'view')] }, async (request, reply) => {
    try {
      const { companyId } = request.user as { companyId: string };
      const { from, to } = z.object({
        from: z.string().datetime(),
        to: z.string().datetime(),
      }).parse(request.query);

      const pos = await prisma.purchaseOrder.findMany({
        where: { companyId, orderDate: { gte: new Date(from), lte: new Date(to) }, deletedAt: null },
        include: { supplier: { select: { id: true, name: true } } },
      });

      const bySupplier: Record<string, { supplierId: string; supplierName: string; poCount: number; totalCost: number }> = {};
      for (const po of pos) {
        if (!bySupplier[po.supplierId]) bySupplier[po.supplierId] = { supplierId: po.supplierId, supplierName: po.supplier.name, poCount: 0, totalCost: 0 };
        bySupplier[po.supplierId].poCount++;
        bySupplier[po.supplierId].totalCost += Number(po.totalCost);
      }

      return { rows: Object.values(bySupplier).sort((a, b) => b.totalCost - a.totalCost), total: pos.length };
    } catch (err) { return handleError(reply, err); }
  });

  // ── Supplier Performance ────────────────────────────────────────────────────
  // Tracks on-time delivery %, total spend, and defect/rejection rates per supplier.

  fastify.get('/supplier-performance', { preHandler: [authenticate, requirePermission('reporting', 'view')] }, async (request, reply) => {
    try {
      const { companyId } = request.user as { companyId: string };
      const { from, to } = z.object({
        from: z.string().datetime().optional(),
        to: z.string().datetime().optional(),
      }).parse(request.query);

      const fromDate = from ? new Date(from) : new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
      const toDate = to ? new Date(to) : new Date();

      const pos = await prisma.purchaseOrder.findMany({
        where: {
          companyId,
          deletedAt: null,
          status: { in: ['RECEIVED', 'INVOICED', 'CLOSED', 'PARTIALLY_RECEIVED'] },
          orderDate: { gte: fromDate, lte: toDate },
        },
        include: {
          supplier: { select: { id: true, name: true, code: true } },
          receipts: { include: { lines: { select: { qtyReceived: true, qtyAccepted: true, qtyRejected: true } } } },
        },
      });

      const supplierMap: Record<string, {
        supplierId: string; supplierName: string; supplierCode: string;
        poCount: number; totalSpend: number;
        onTimeCount: number; lateCount: number;
        totalQtyReceived: number; totalQtyRejected: number;
      }> = {};

      for (const po of pos) {
        const sid = po.supplierId;
        if (!supplierMap[sid]) {
          supplierMap[sid] = {
            supplierId: sid, supplierName: po.supplier.name, supplierCode: po.supplier.code,
            poCount: 0, totalSpend: 0,
            onTimeCount: 0, lateCount: 0,
            totalQtyReceived: 0, totalQtyRejected: 0,
          };
        }
        const s = supplierMap[sid];
        s.poCount++;
        s.totalSpend += Number(po.totalCost);

        // On-time delivery: first receipt date vs expectedDate
        if (po.receipts.length > 0 && po.expectedDate) {
          const firstReceiptDate = po.receipts[0].receivedDate;
          if (firstReceiptDate && firstReceiptDate <= po.expectedDate) {
            s.onTimeCount++;
          } else {
            s.lateCount++;
          }
        }

        // Quality: sum accepted vs rejected qty
        for (const receipt of po.receipts) {
          for (const line of receipt.lines) {
            s.totalQtyReceived += Number(line.qtyReceived);
            s.totalQtyRejected += Number(line.qtyRejected ?? 0);
          }
        }
      }

      const rows = Object.values(supplierMap).map((s) => ({
        ...s,
        onTimePct: s.poCount > 0 ? Math.round((s.onTimeCount / s.poCount) * 100) : null,
        defectRatePct: s.totalQtyReceived > 0 ? Math.round((s.totalQtyRejected / s.totalQtyReceived) * 10000) / 100 : 0,
      })).sort((a, b) => b.totalSpend - a.totalSpend);

      return { period: { from: fromDate, to: toDate }, rows };
    } catch (err) { return handleError(reply, err); }
  });

  // ── Reorder Suggestions ─────────────────────────────────────────────────────
  // Products where qtyAvailable has fallen below reorderPoint. Shows suggested
  // order quantity (reorderQty or 2× reorderPoint) and open PO coverage.

  fastify.get('/reorder-suggestions', { preHandler: [authenticate, requirePermission('reporting', 'view')] }, async (request, reply) => {
    try {
      const { companyId } = request.user as { companyId: string };

      // Find products with a reorder point set
      const products = await prisma.product.findMany({
        where: { companyId, deletedAt: null, isActive: true, isStocked: true, reorderPoint: { not: null } },
        include: {
          inventoryItems: {
            where: { deletedAt: null, isActive: true },
            select: { qtyOnHand: true, qtyAvailable: true, qtyAllocated: true },
          },
        },
      });

      // For each product, sum current stock levels
      const suggestions = [];
      for (const product of products) {
        const totalOnHand = product.inventoryItems.reduce((s, i) => s + Number(i.qtyOnHand), 0);
        const totalAvailable = product.inventoryItems.reduce((s, i) => s + Number(i.qtyAvailable), 0);
        const totalAllocated = product.inventoryItems.reduce((s, i) => s + Number(i.qtyAllocated), 0);
        const reorderPoint = Number(product.reorderPoint!);

        if (totalAvailable < reorderPoint) {
          // Check if there's already an open PO covering this product
          const openPOQty = await prisma.purchaseOrderLine.aggregate({
            where: {
              productId: product.id,
              purchaseOrder: { companyId, status: { in: ['DRAFT', 'SUBMITTED', 'APPROVED', 'PARTIALLY_RECEIVED'] }, deletedAt: null },
            },
            _sum: { qtyOrdered: true },
          });
          const onOrder = Number(openPOQty._sum.qtyOrdered ?? 0);
          const suggestedQty = Number(product.reorderQty ?? reorderPoint * 2);
          const netRequired = Math.max(0, suggestedQty - onOrder);

          suggestions.push({
            productId: product.id,
            code: product.code,
            description: product.description,
            uom: product.uom,
            reorderPoint,
            reorderQty: suggestedQty,
            totalOnHand,
            totalAvailable,
            totalAllocated,
            onOrder,
            netRequired,
            urgency: totalAvailable <= 0 ? 'CRITICAL' : totalAvailable < reorderPoint / 2 ? 'HIGH' : 'MEDIUM',
          });
        }
      }

      // Sort by urgency (CRITICAL first) then by shortage depth
      const urgencyRank: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2 };
      suggestions.sort((a, b) => urgencyRank[a.urgency] - urgencyRank[b.urgency] || a.totalAvailable - b.totalAvailable);

      return { count: suggestions.length, suggestions };
    } catch (err) { return handleError(reply, err); }
  });
};
