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
        lowStockCount,
        openWorkOrders,
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

        // Overdue invoices
        prisma.invoice.aggregate({ where: { companyId, dueDate: { lt: now }, status: { notIn: ['PAID', 'CANCELLED', 'WRITTEN_OFF'] }, deletedAt: null }, _sum: { balanceDue: true }, _count: { id: true } }),

        // Open POs
        prisma.purchaseOrder.count({ where: { companyId, status: { in: ['SUBMITTED', 'APPROVED', 'PARTIALLY_RECEIVED'] }, deletedAt: null } }),

        // Low stock
        prisma.inventoryItem.count({ where: { deletedAt: null, isActive: true, product: { companyId, reorderPoint: { not: null } } } }),

        // Open work orders
        prisma.workOrder.count({ where: { companyId, status: { in: ['SCHEDULED', 'IN_PROGRESS'] }, deletedAt: null } }),
      ]);

      return {
        sales: {
          today: { amount: Number(salesToday._sum.totalAmount ?? 0), count: salesToday._count.id },
          week: { amount: Number(salesWeek._sum.totalAmount ?? 0), count: salesWeek._count.id },
          month: { amount: Number(salesMonth._sum.totalAmount ?? 0), count: salesMonth._count.id },
        },
        orders: { open: openOrders, openQuotes },
        inventory: { value: Number(inventoryValue._sum.totalCost ?? 0), lowStockCount },
        ar: { overdueBalance: Number(overdueInvoices._sum.balanceDue ?? 0), overdueCount: overdueInvoices._count.id },
        purchasing: { openPOs },
        production: { openWorkOrders },
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

      // Default: on-hand
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
};
