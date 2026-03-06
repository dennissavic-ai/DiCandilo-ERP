import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { authenticate, requirePermission } from '../../middleware/auth.middleware';
import { handleError, NotFoundError } from '../../utils/errors';

export const nestingRoutes: FastifyPluginAsync = async (fastify) => {

  fastify.get('/jobs', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const { companyId } = request.user as { companyId: string };
      const jobs = await prisma.nestingJob.findMany({
        where: { companyId },
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { pieces: true } } },
      });
      return jobs;
    } catch (err) { return handleError(reply, err); }
  });

  fastify.get('/jobs/:id', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const job = await prisma.nestingJob.findFirst({
        where: { id },
        include: { pieces: { orderBy: { position: 'asc' } } },
      });
      if (!job) throw new NotFoundError('NestingJob', id);
      return job;
    } catch (err) { return handleError(reply, err); }
  });

  fastify.post('/jobs', { preHandler: [authenticate, requirePermission('processing', 'create')] }, async (request, reply) => {
    try {
      const { companyId, sub } = request.user as { companyId: string; sub: string };
      const body = z.object({
        type: z.enum(['LINEAR', 'PLATE']),
        stockLength: z.number().int().positive(),
        stockWidth: z.number().int().positive().optional(),
        stockQty: z.number().int().positive(),
        workOrderId: z.string().uuid().optional(),
        notes: z.string().optional(),
        pieces: z.array(z.object({
          lineNumber: z.number().int().positive(),
          description: z.string().optional(),
          length: z.number().int().positive(),
          width: z.number().int().positive().optional(),
          qty: z.number().int().positive(),
          productId: z.string().uuid().optional(),
        })).min(1),
      }).parse(request.body);

      const count = await prisma.nestingJob.count({ where: { companyId } });
      const jobNumber = `NJ-${String(count + 1).padStart(5, '0')}`;

      // Run linear nesting algorithm
      let resultData: unknown = null;
      if (body.type === 'LINEAR') {
        resultData = runLinearNesting(body.stockLength, body.stockQty, body.pieces);
      }

      const job = await prisma.nestingJob.create({
        data: {
          companyId,
          jobNumber,
          type: body.type,
          status: 'COMPLETE',
          stockLength: body.stockLength,
          stockWidth: body.stockWidth,
          stockQty: body.stockQty,
          workOrderId: body.workOrderId,
          notes: body.notes,
          resultData: resultData as Prisma.InputJsonValue,
          createdBy: sub,
          pieces: {
            create: body.pieces.map((p, i) => ({
              ...p,
              position: i + 1,
              qtyNested: body.type === 'LINEAR' ? p.qty : 0,
            })),
          },
          efficiencyPct: resultData ? (resultData as { efficiency: number }).efficiency : 0,
        },
        include: { pieces: { orderBy: { position: 'asc' } } },
      });
      return reply.status(201).send(job);
    } catch (err) { return handleError(reply, err); }
  });
};

// ─── Linear Nesting Algorithm ─────────────────────────────────────────────────

interface NestingPieceInput {
  lineNumber: number;
  length: number;
  qty: number;
  description?: string;
}

interface CutPlan {
  stockIndex: number;
  cuts: Array<{ pieceIndex: number; length: number; description?: string }>;
  remnant: number;
  utilisation: number;
}

function runLinearNesting(
  stockLength: number,
  stockQty: number,
  pieces: NestingPieceInput[]
): { cutPlans: CutPlan[]; efficiency: number; totalScrap: number; totalStockUsed: number } {
  // Flatten pieces into individual cut requirements
  const cuts: Array<{ pieceIndex: number; length: number; description?: string }> = [];
  pieces.forEach((p, idx) => {
    for (let i = 0; i < p.qty; i++) {
      cuts.push({ pieceIndex: idx, length: p.length, description: p.description });
    }
  });

  // Sort cuts by length descending (First Fit Decreasing)
  cuts.sort((a, b) => b.length - a.length);

  const cutPlans: CutPlan[] = [];
  const kerf = 3; // 3mm saw kerf allowance
  let stockIndex = 0;

  while (cuts.length > 0 && stockIndex < stockQty) {
    let remaining = stockLength;
    const plan: CutPlan = { stockIndex, cuts: [], remnant: 0, utilisation: 0 };

    let i = 0;
    while (i < cuts.length) {
      const cutWithKerf = cuts[i].length + (plan.cuts.length > 0 ? kerf : 0);
      if (cutWithKerf <= remaining) {
        plan.cuts.push(cuts[i]);
        remaining -= cutWithKerf;
        cuts.splice(i, 1);
      } else {
        i++;
      }
    }

    plan.remnant = remaining;
    plan.utilisation = ((stockLength - remaining) / stockLength) * 100;
    cutPlans.push(plan);
    stockIndex++;
  }

  const totalStockUsed = cutPlans.length;
  const totalScrap = cutPlans.reduce((s, p) => s + p.remnant, 0);
  const totalUsed = totalStockUsed * stockLength - totalScrap;
  const efficiency = totalStockUsed > 0 ? (totalUsed / (totalStockUsed * stockLength)) * 100 : 0;

  return { cutPlans, efficiency: Math.round(efficiency * 100) / 100, totalScrap, totalStockUsed };
}
