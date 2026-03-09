import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../../config/database';
import { authenticate } from '../../middleware/auth.middleware';
import { handleError, NotFoundError } from '../../utils/errors';
import { parsePagination, paginatedResponse } from '../../utils/pagination';
import { sendEmail, prospectStageTemplate } from '../../utils/email';

// ─── Default pipeline stages (seeded when a company has none) ─────────────────

const DEFAULT_STAGES = [
  { name: 'LEAD',        color: 'gray',   order: 0, isWon: false, isLost: false },
  { name: 'CONTACTED',   color: 'blue',   order: 1, isWon: false, isLost: false },
  { name: 'QUALIFIED',   color: 'teal',   order: 2, isWon: false, isLost: false },
  { name: 'PROPOSAL',    color: 'amber',  order: 3, isWon: false, isLost: false },
  { name: 'NEGOTIATION', color: 'orange', order: 4, isWon: false, isLost: false },
  { name: 'WON',         color: 'green',  order: 5, isWon: true,  isLost: false },
  { name: 'LOST',        color: 'red',    order: 6, isWon: false, isLost: true  },
];

async function getOrSeedStages(companyId: string): Promise<any[]> {
  let stages = await (prisma as any).pipelineStage.findMany({
    where: { companyId },
    orderBy: { order: 'asc' },
  });

  if (stages.length === 0) {
    await (prisma as any).pipelineStage.createMany({
      data: DEFAULT_STAGES.map((s) => ({ ...s, companyId })),
    });
    stages = await (prisma as any).pipelineStage.findMany({
      where: { companyId },
      orderBy: { order: 'asc' },
    });
  }

  return stages;
}

// ─── Stage-change email helper ────────────────────────────────────────────────

async function maybeSendStageEmail(
  companyId: string,
  prospect: any,
  newStage: string,
): Promise<void> {
  if (!prospect.email) return;

  const trigger = `CRM_STAGE_${newStage.toUpperCase()}`;

  let rule: any = null;
  try {
    rule = await (prisma as any).emailAutomationRule.findUnique({
      where: { companyId_trigger: { companyId, trigger } },
    });
  } catch {
    // Table may not have this row yet — that is fine
  }

  if (!rule?.isEnabled) return;

  const subject = rule.subject || `Update on your enquiry with Di Candilo`;
  const html    = prospectStageTemplate({
    stage:       newStage,
    contactName: prospect.contactName ?? prospect.companyName,
    companyName: prospect.companyName,
  });

  try {
    await sendEmail(prospect.email, subject, html);

    await (prisma as any).emailLog.create({
      data: {
        companyId,
        trigger,
        entityType: 'Prospect',
        entityId:   prospect.id,
        recipient:  prospect.email,
        subject,
        status:     'SENT',
      },
    });
  } catch (err) {
    await (prisma as any).emailLog.create({
      data: {
        companyId,
        trigger,
        entityType: 'Prospect',
        entityId:   prospect.id,
        recipient:  prospect.email,
        subject,
        status:     'FAILED',
        errorMsg:   String(err),
      },
    }).catch(() => {});
  }
}

// ─── CRM Routes ───────────────────────────────────────────────────────────────

export const crmRoutes: FastifyPluginAsync = async (fastify) => {

  // ════════════════════════════════════════════════════════════════
  //  PIPELINE STAGES
  // ════════════════════════════════════════════════════════════════

  /** GET /crm/pipeline-stages — list (seeds defaults on first call) */
  fastify.get('/pipeline-stages', { preHandler: [authenticate] }, async (request, reply) => {
    const { companyId } = request.user as any;
    try {
      const stages = await getOrSeedStages(companyId);
      return reply.send(stages);
    } catch (err) { return handleError(reply, err); }
  });

  /** PUT /crm/pipeline-stages — replace all stages for this company */
  fastify.put('/pipeline-stages', { preHandler: [authenticate] }, async (request, reply) => {
    const { companyId } = request.user as any;
    const body = request.body as { stages: Array<{ id?: string; name: string; color: string; order: number; isWon: boolean; isLost: boolean }> };

    if (!Array.isArray(body?.stages) || body.stages.length === 0) {
      return reply.status(400).send({ error: 'stages array required' });
    }

    try {
      await prisma.$transaction(async (tx: any) => {
        // Delete existing stages
        await tx.pipelineStage.deleteMany({ where: { companyId } });
        // Re-create in the supplied order
        await tx.pipelineStage.createMany({
          data: body.stages.map((s, i) => ({
            companyId,
            name:  s.name.trim(),
            color: s.color,
            order: i,
            isWon:  Boolean(s.isWon),
            isLost: Boolean(s.isLost),
          })),
        });
      });

      const stages = await (prisma as any).pipelineStage.findMany({
        where: { companyId },
        orderBy: { order: 'asc' },
      });
      return reply.send(stages);
    } catch (err) { return handleError(reply, err); }
  });

  // ════════════════════════════════════════════════════════════════
  //  PROSPECTS
  // ════════════════════════════════════════════════════════════════

  /** GET /crm/prospects */
  fastify.get('/prospects', { preHandler: [authenticate] }, async (request, reply) => {
    const { companyId } = request.user as any;
    const q = request.query as any;
    const { skip, take, page, limit } = parsePagination({ page: q.page, limit: q.limit ?? 500 });

    const where: any = { companyId, deletedAt: null };
    if (q.stage) where.stage = q.stage;
    if (q.search) {
      where.OR = [
        { companyName: { contains: q.search, mode: 'insensitive' } },
        { contactName: { contains: q.search, mode: 'insensitive' } },
        { email:       { contains: q.search, mode: 'insensitive' } },
      ];
    }

    try {
      const [data, total] = await Promise.all([
        (prisma as any).prospect.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } }),
        (prisma as any).prospect.count({ where }),
      ]);
      return reply.send(paginatedResponse(data, total, page, limit));
    } catch (err) { return handleError(reply, err); }
  });

  /** GET /crm/prospects/:id */
  fastify.get('/prospects/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const { companyId } = request.user as any;
    const { id } = request.params as { id: string };
    try {
      const p = await (prisma as any).prospect.findFirst({ where: { id, companyId, deletedAt: null } });
      if (!p) throw new NotFoundError('Prospect', id);
      return reply.send(p);
    } catch (err) { return handleError(reply, err); }
  });

  /** POST /crm/prospects */
  fastify.post('/prospects', { preHandler: [authenticate] }, async (request, reply) => {
    const { companyId, sub } = request.user as any;
    const body = request.body as any;
    try {
      const p = await (prisma as any).prospect.create({
        data: {
          companyId,
          companyName:    body.companyName,
          contactName:    body.contactName   ?? null,
          email:          body.email         ?? null,
          phone:          body.phone         ?? null,
          stage:          body.stage         ?? 'LEAD',
          industry:       body.industry      ?? null,
          estimatedValue: body.estimatedValue
            ? BigInt(Math.round(parseFloat(String(body.estimatedValue)) * 100))
            : null,
          probability:    body.probability   ?? 50,
          nextFollowUp:   body.nextFollowUp  ? new Date(body.nextFollowUp) : null,
          notes:          body.notes         ?? null,
          createdBy:      sub,
          updatedBy:      sub,
        },
      });
      return reply.status(201).send(p);
    } catch (err) { return handleError(reply, err); }
  });

  /** PUT /crm/prospects/:id */
  fastify.put('/prospects/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const { companyId, sub } = request.user as any;
    const { id } = request.params as { id: string };
    const body = request.body as any;
    try {
      const existing = await (prisma as any).prospect.findFirst({ where: { id, companyId, deletedAt: null } });
      if (!existing) throw new NotFoundError('Prospect', id);

      const updated = await (prisma as any).prospect.update({
        where: { id },
        data: {
          companyName:    body.companyName,
          contactName:    body.contactName   ?? null,
          email:          body.email         ?? null,
          phone:          body.phone         ?? null,
          stage:          body.stage         ?? existing.stage,
          industry:       body.industry      ?? null,
          estimatedValue: body.estimatedValue !== undefined
            ? (body.estimatedValue
                ? BigInt(Math.round(parseFloat(String(body.estimatedValue)) * 100))
                : null)
            : existing.estimatedValue,
          probability:    body.probability   ?? existing.probability,
          nextFollowUp:   body.nextFollowUp  ? new Date(body.nextFollowUp) : null,
          notes:          body.notes         ?? null,
          updatedBy:      sub,
        },
      });
      return reply.send(updated);
    } catch (err) { return handleError(reply, err); }
  });

  /** PATCH /crm/prospects/:id/stage — stage change + email trigger */
  fastify.patch('/prospects/:id/stage', { preHandler: [authenticate] }, async (request, reply) => {
    const { companyId, sub } = request.user as any;
    const { id } = request.params as { id: string };
    const { stage } = request.body as { stage: string };

    try {
      const existing = await (prisma as any).prospect.findFirst({ where: { id, companyId, deletedAt: null } });
      if (!existing) throw new NotFoundError('Prospect', id);

      const updated = await (prisma as any).prospect.update({
        where: { id },
        data: { stage, updatedBy: sub },
      });

      // Fire email asynchronously — do not block the response
      void maybeSendStageEmail(companyId, existing, stage);

      return reply.send(updated);
    } catch (err) { return handleError(reply, err); }
  });

  /** DELETE /crm/prospects/:id */
  fastify.delete('/prospects/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const { companyId } = request.user as any;
    const { id } = request.params as { id: string };
    try {
      const p = await (prisma as any).prospect.findFirst({ where: { id, companyId, deletedAt: null } });
      if (!p) throw new NotFoundError('Prospect', id);
      await (prisma as any).prospect.update({ where: { id }, data: { deletedAt: new Date() } });
      return reply.send({ success: true });
    } catch (err) { return handleError(reply, err); }
  });

  // ════════════════════════════════════════════════════════════════
  //  CALL REPORTS
  // ════════════════════════════════════════════════════════════════

  /** GET /crm/call-reports */
  fastify.get('/call-reports', { preHandler: [authenticate] }, async (request, reply) => {
    const { companyId } = request.user as any;
    const q = request.query as any;
    const { skip, take, page, limit } = parsePagination({ page: q.page, limit: q.limit ?? 200 });

    const where: any = { companyId, deletedAt: null };
    if (q.type)       where.type       = q.type;
    if (q.prospectId) where.prospectId = q.prospectId;
    if (q.customerId) where.customerId = q.customerId;
    if (q.search) {
      where.OR = [
        { subject:           { contains: q.search, mode: 'insensitive' } },
        { prospect: { companyName: { contains: q.search, mode: 'insensitive' } } },
        { customer: { name:        { contains: q.search, mode: 'insensitive' } } },
      ];
    }

    try {
      const [data, total] = await Promise.all([
        (prisma as any).callReport.findMany({
          where,
          skip,
          take,
          orderBy: { callDate: 'desc' },
          include: {
            prospect: { select: { id: true, companyName: true, contactName: true } },
            customer: { select: { id: true, name: true, code: true } },
            user:     { select: { id: true, firstName: true, lastName: true } },
          },
        }),
        (prisma as any).callReport.count({ where }),
      ]);

      // Normalise user.name for the frontend
      const normalised = data.map((r: any) => ({
        ...r,
        user: r.user
          ? { ...r.user, name: `${r.user.firstName} ${r.user.lastName}`.trim() }
          : null,
      }));

      return reply.send(paginatedResponse(normalised, total, page, limit));
    } catch (err) { return handleError(reply, err); }
  });

  /** POST /crm/call-reports */
  fastify.post('/call-reports', { preHandler: [authenticate] }, async (request, reply) => {
    const { companyId, sub } = request.user as any;
    const body = request.body as any;
    try {
      const report = await (prisma as any).callReport.create({
        data: {
          companyId,
          prospectId:      body.prospectId      ?? null,
          customerId:      body.customerId       ?? null,
          userId:          sub,
          type:            body.type             ?? 'CALL',
          callDate:        body.callDate ? new Date(body.callDate) : new Date(),
          durationMinutes: body.durationMinutes  ? parseInt(body.durationMinutes, 10) : null,
          subject:         body.subject,
          notes:           body.notes            ?? null,
          outcome:         body.outcome          ?? 'FOLLOW_UP',
          followUpDate:    body.followUpDate     ? new Date(body.followUpDate) : null,
          createdBy:       sub,
        },
        include: {
          prospect: { select: { id: true, companyName: true, contactName: true } },
          customer: { select: { id: true, name: true, code: true } },
          user:     { select: { id: true, firstName: true, lastName: true } },
        },
      });

      const r = {
        ...report,
        user: report.user
          ? { ...report.user, name: `${report.user.firstName} ${report.user.lastName}`.trim() }
          : null,
      };

      return reply.status(201).send(r);
    } catch (err) { return handleError(reply, err); }
  });
};
