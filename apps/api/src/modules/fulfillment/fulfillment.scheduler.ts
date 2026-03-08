import { FastifyInstance } from 'fastify';
import { prisma } from '../../config/database';

const INTERVAL_MS = 60 * 60 * 1000; // 1 hour
export const AUTO_FULFILLMENT_TAG = '[AUTO-FULFILLMENT]';

// ─── Scheduler Entry Point ────────────────────────────────────────────────────

export function startFulfillmentScheduler(fastify: FastifyInstance): void {
  fastify.log.info('[fulfillment] Auto-fulfillment scheduler starting (interval: 1 hour)');

  void runScheduler(fastify);
  setInterval(() => { void runScheduler(fastify); }, INTERVAL_MS);
}

// ─── Main Loop ────────────────────────────────────────────────────────────────

async function runScheduler(fastify: FastifyInstance): Promise<void> {
  fastify.log.debug('[fulfillment] Running scheduler tick');

  let companies: Array<{ id: string }> = [];
  try {
    companies = await prisma.company.findMany({
      where: { isActive: true },
      select: { id: true },
    });
  } catch (err) {
    fastify.log.error({ err }, '[fulfillment] Failed to fetch companies');
    return;
  }

  for (const company of companies) {
    try {
      const result = await runFulfillmentCheckForCompany(fastify, company.id);
      if (result.posCreated > 0) {
        fastify.log.info(
          { companyId: company.id, posCreated: result.posCreated },
          '[fulfillment] Draft POs created by auto-fulfillment check',
        );
      }
    } catch (err) {
      fastify.log.error({ err, companyId: company.id }, '[fulfillment] Error processing company');
    }
  }
}

// ─── Per-Company Check (also called manually from API routes) ─────────────────

export interface FulfillmentCheckResult {
  checked: number;
  posCreated: number;
  skipped: number;
  details: Array<{ productCode: string; poNumber: string; supplierId: string }>;
}

export async function runFulfillmentCheckForCompany(
  fastify: FastifyInstance,
  companyId: string,
): Promise<FulfillmentCheckResult> {
  let rules: any[] = [];

  try {
    rules = await (prisma as any).autoFulfillmentRule.findMany({
      where: { companyId, isActive: true, deletedAt: null },
      include: {
        product: { select: { id: true, code: true, description: true, uom: true } },
        supplier: { select: { id: true, code: true, name: true } },
      },
    });
  } catch (err) {
    fastify.log.warn(
      { err, companyId },
      '[fulfillment] Could not query AutoFulfillmentRule — has the schema been migrated?',
    );
    return { checked: 0, posCreated: 0, skipped: 0, details: [] };
  }

  if (rules.length === 0) {
    return { checked: 0, posCreated: 0, skipped: 0, details: [] };
  }

  // Resolve the default branch for PO creation
  const branch = await prisma.branch.findFirst({
    where: { companyId, deletedAt: null },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    select: { id: true },
  });

  if (!branch) {
    fastify.log.warn({ companyId }, '[fulfillment] No branch found for company, skipping');
    return { checked: rules.length, posCreated: 0, skipped: rules.length, details: [] };
  }

  const details: FulfillmentCheckResult['details'] = [];
  let skipped = 0;

  for (const rule of rules) {
    try {
      const created = await processRule(fastify, companyId, branch.id, rule);
      if (created) {
        details.push(created);
      } else {
        skipped++;
      }
    } catch (err) {
      fastify.log.error({ err, ruleId: rule.id }, '[fulfillment] Error processing rule');
      skipped++;
    }
  }

  return { checked: rules.length, posCreated: details.length, skipped, details };
}

// ─── Per-Rule Processing ──────────────────────────────────────────────────────

async function processRule(
  fastify: FastifyInstance,
  companyId: string,
  branchId: string,
  rule: any,
): Promise<{ productCode: string; poNumber: string; supplierId: string } | null> {
  // Sum qtyAvailable across all active inventory items for this product
  const items = await prisma.inventoryItem.findMany({
    where: { productId: rule.productId, deletedAt: null, isActive: true },
    select: { qtyAvailable: true },
  });

  const totalAvailable = items.reduce(
    (sum, item) => sum + parseFloat(item.qtyAvailable.toString()),
    0,
  );

  const reorderPoint = parseFloat(rule.reorderPoint.toString());

  if (totalAvailable >= reorderPoint) {
    // Still above the threshold — nothing to do
    return null;
  }

  fastify.log.info(
    {
      ruleId: rule.id,
      productCode: rule.product.code,
      totalAvailable,
      reorderPoint,
    },
    '[fulfillment] Product below reorder point — checking for existing draft PO',
  );

  // Avoid duplicate draft POs: skip if an auto-fulfillment DRAFT already exists
  // for this product + supplier combination
  const existingPO = await prisma.purchaseOrder.findFirst({
    where: {
      companyId,
      supplierId: rule.supplierId,
      status: 'DRAFT',
      deletedAt: null,
      notes: { startsWith: AUTO_FULFILLMENT_TAG },
      lines: { some: { productId: rule.productId } },
    },
    select: { id: true, poNumber: true },
  });

  if (existingPO) {
    fastify.log.debug(
      { ruleId: rule.id, existingPoId: existingPO.id },
      '[fulfillment] Auto-fulfillment draft PO already exists — skipping',
    );
    return null;
  }

  // Generate a PO number (same PO-XXXXXX format as purchasing module)
  const poCount = await prisma.purchaseOrder.count({ where: { companyId } });
  const poNumber = `PO-${String(poCount + 1).padStart(6, '0')}`;

  const reorderQty = parseFloat(rule.reorderQty.toString());
  const unitPrice = Number(rule.unitPrice) || 0;
  const lineTotal = Math.round(reorderQty * unitPrice);

  const po = await prisma.purchaseOrder.create({
    data: {
      companyId,
      branchId,
      supplierId: rule.supplierId,
      poNumber,
      status: 'DRAFT',
      subtotal: BigInt(lineTotal),
      totalCost: BigInt(lineTotal),
      notes: [
        AUTO_FULFILLMENT_TAG,
        `Auto-generated by inventory fulfillment check.`,
        `Product "${rule.product.code}" available qty (${totalAvailable.toFixed(4)} ${rule.product.uom})`,
        `fell below reorder point (${reorderPoint} ${rule.product.uom}).`,
        `Please review and approve to send the PO to ${rule.supplier.name}.`,
      ].join(' '),
      lines: {
        create: [
          {
            lineNumber: 1,
            productId: rule.productId,
            description: rule.product.description,
            uom: rule.product.uom,
            qtyOrdered: rule.reorderQty,
            unitPrice: BigInt(unitPrice),
            lineTotal: BigInt(lineTotal),
          },
        ],
      },
    },
    select: { id: true, poNumber: true },
  });

  // Record when this rule last fired
  await (prisma as any).autoFulfillmentRule.update({
    where: { id: rule.id },
    data: { lastTriggeredAt: new Date() },
  });

  fastify.log.info(
    { ruleId: rule.id, poId: po.id, poNumber: po.poNumber },
    '[fulfillment] Draft PO created by auto-fulfillment',
  );

  return { productCode: rule.product.code, poNumber: po.poNumber, supplierId: rule.supplierId };
}
