import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../../config/database';
import { authenticate } from '../../middleware/auth.middleware';
import { emitToCompany } from '../../websocket/ws.plugin';

const CreateMapSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
});

const UpdateMapSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).nullable().optional(),
});

const NodeSchema = z.object({
  type: z.enum(['SUPPLIER', 'PROCESS', 'INVENTORY', 'SHIPPING', 'CUSTOMER']).default('PROCESS'),
  label: z.string().min(1).max(100),
  position: z.number().int().min(0).optional(),
  cycleTimeSec: z.number().int().min(0).nullable().optional(),
  changeOverSec: z.number().int().min(0).nullable().optional(),
  uptimePct: z.number().min(0).max(100).nullable().optional(),
  operatorCount: z.number().int().min(0).nullable().optional(),
  batchSize: z.number().int().min(1).nullable().optional(),
  waitTimeSec: z.number().int().min(0).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});

const ReorderSchema = z.object({
  nodeIds: z.array(z.string().uuid()),
});

const valuestream: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', authenticate);

  // ── GET /vsm — list all maps for the company ────────────────────────────────
  fastify.get('/', async (request) => {
    const user = (request as any).user;
    const maps = await (prisma as any).valueStreamMap.findMany({
      where: { companyId: user.companyId, deletedAt: null },
      include: {
        _count: { select: { nodes: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
    return maps;
  });

  // ── POST /vsm — create a new map ────────────────────────────────────────────
  fastify.post('/', async (request, reply) => {
    const user = (request as any).user;
    const body = CreateMapSchema.parse(request.body);
    const map = await (prisma as any).valueStreamMap.create({
      data: {
        companyId: user.companyId,
        name: body.name,
        description: body.description ?? null,
        createdBy: user.sub,
        updatedAt: new Date(),
      },
      include: { nodes: { orderBy: { position: 'asc' } } },
    });
    emitToCompany(user.companyId, 'VSM_UPDATE', { mapId: map.id, action: 'MAP_CREATED', map });
    return reply.status(201).send(map);
  });

  // ── GET /vsm/:id — get a map with all nodes ─────────────────────────────────
  fastify.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = (request as any).user;
    const map = await (prisma as any).valueStreamMap.findFirst({
      where: { id, companyId: user.companyId, deletedAt: null },
      include: { nodes: { orderBy: { position: 'asc' } } },
    });
    if (!map) return reply.status(404).send({ error: 'Map not found' });
    return map;
  });

  // ── PUT /vsm/:id — update map name / description ────────────────────────────
  fastify.put('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = (request as any).user;
    const body = UpdateMapSchema.parse(request.body);
    const existing = await (prisma as any).valueStreamMap.findFirst({
      where: { id, companyId: user.companyId, deletedAt: null },
    });
    if (!existing) return reply.status(404).send({ error: 'Map not found' });
    const updated = await (prisma as any).valueStreamMap.update({
      where: { id },
      data: { ...body, updatedBy: user.sub, updatedAt: new Date() },
      include: { nodes: { orderBy: { position: 'asc' } } },
    });
    emitToCompany(user.companyId, 'VSM_UPDATE', { mapId: id, action: 'MAP_UPDATED', map: updated });
    return updated;
  });

  // ── DELETE /vsm/:id — soft-delete a map ─────────────────────────────────────
  fastify.delete('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = (request as any).user;
    const existing = await (prisma as any).valueStreamMap.findFirst({
      where: { id, companyId: user.companyId, deletedAt: null },
    });
    if (!existing) return reply.status(404).send({ error: 'Map not found' });
    await (prisma as any).valueStreamMap.update({
      where: { id },
      data: { deletedAt: new Date(), updatedBy: user.sub, updatedAt: new Date() },
    });
    emitToCompany(user.companyId, 'VSM_UPDATE', { mapId: id, action: 'MAP_DELETED' });
    return { ok: true };
  });

  // ── POST /vsm/:id/nodes — add a node to the map ──────────────────────────────
  fastify.post('/:id/nodes', async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = (request as any).user;
    const body = NodeSchema.parse(request.body);

    const map = await (prisma as any).valueStreamMap.findFirst({
      where: { id, companyId: user.companyId, deletedAt: null },
      include: { nodes: { select: { position: true }, orderBy: { position: 'desc' } } },
    });
    if (!map) return reply.status(404).send({ error: 'Map not found' });

    const nextPosition = map.nodes.length > 0 ? map.nodes[0].position + 1 : 0;

    const node = await (prisma as any).vSMNode.create({
      data: {
        mapId: id,
        type: body.type,
        label: body.label,
        position: body.position ?? nextPosition,
        cycleTimeSec: body.cycleTimeSec ?? null,
        changeOverSec: body.changeOverSec ?? null,
        uptimePct: body.uptimePct ?? null,
        operatorCount: body.operatorCount ?? null,
        batchSize: body.batchSize ?? null,
        waitTimeSec: body.waitTimeSec ?? null,
        notes: body.notes ?? null,
        updatedAt: new Date(),
      },
    });

    await (prisma as any).valueStreamMap.update({
      where: { id },
      data: { updatedAt: new Date(), updatedBy: user.sub },
    });

    emitToCompany(user.companyId, 'VSM_UPDATE', { mapId: id, action: 'NODE_ADDED', node });
    return reply.status(201).send(node);
  });

  // ── PUT /vsm/:id/nodes/:nodeId — update a node ───────────────────────────────
  fastify.put('/:id/nodes/:nodeId', async (request, reply) => {
    const { id, nodeId } = request.params as { id: string; nodeId: string };
    const user = (request as any).user;
    const body = NodeSchema.partial().parse(request.body);

    const map = await (prisma as any).valueStreamMap.findFirst({
      where: { id, companyId: user.companyId, deletedAt: null },
    });
    if (!map) return reply.status(404).send({ error: 'Map not found' });

    const node = await (prisma as any).vSMNode.findFirst({ where: { id: nodeId, mapId: id } });
    if (!node) return reply.status(404).send({ error: 'Node not found' });

    const updated = await (prisma as any).vSMNode.update({
      where: { id: nodeId },
      data: { ...body, updatedAt: new Date() },
    });

    await (prisma as any).valueStreamMap.update({
      where: { id },
      data: { updatedAt: new Date(), updatedBy: user.sub },
    });

    emitToCompany(user.companyId, 'VSM_UPDATE', { mapId: id, action: 'NODE_UPDATED', node: updated });
    return updated;
  });

  // ── DELETE /vsm/:id/nodes/:nodeId — remove a node ───────────────────────────
  fastify.delete('/:id/nodes/:nodeId', async (request, reply) => {
    const { id, nodeId } = request.params as { id: string; nodeId: string };
    const user = (request as any).user;

    const map = await (prisma as any).valueStreamMap.findFirst({
      where: { id, companyId: user.companyId, deletedAt: null },
    });
    if (!map) return reply.status(404).send({ error: 'Map not found' });

    await (prisma as any).vSMNode.deleteMany({ where: { id: nodeId, mapId: id } });

    await (prisma as any).valueStreamMap.update({
      where: { id },
      data: { updatedAt: new Date(), updatedBy: user.sub },
    });

    emitToCompany(user.companyId, 'VSM_UPDATE', { mapId: id, action: 'NODE_DELETED', nodeId });
    return { ok: true };
  });

  // ── PUT /vsm/:id/nodes/reorder — reorder all nodes ──────────────────────────
  fastify.put('/:id/nodes/reorder', async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = (request as any).user;
    const { nodeIds } = ReorderSchema.parse(request.body);

    const map = await (prisma as any).valueStreamMap.findFirst({
      where: { id, companyId: user.companyId, deletedAt: null },
    });
    if (!map) return reply.status(404).send({ error: 'Map not found' });

    await Promise.all(
      nodeIds.map((nodeId, idx) =>
        (prisma as any).vSMNode.updateMany({
          where: { id: nodeId, mapId: id },
          data: { position: idx, updatedAt: new Date() },
        })
      )
    );

    await (prisma as any).valueStreamMap.update({
      where: { id },
      data: { updatedAt: new Date(), updatedBy: user.sub },
    });

    const nodes = await (prisma as any).vSMNode.findMany({
      where: { mapId: id },
      orderBy: { position: 'asc' },
    });

    emitToCompany(user.companyId, 'VSM_UPDATE', { mapId: id, action: 'NODES_REORDERED', nodes });
    return nodes;
  });

  // ── POST /vsm/:id/promote — auto-populate nodes from active work centers ─────
  fastify.post('/:id/promote', async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = (request as any).user;

    const map = await (prisma as any).valueStreamMap.findFirst({
      where: { id, companyId: user.companyId, deletedAt: null },
      include: { nodes: { select: { id: true } } },
    });
    if (!map) return reply.status(404).send({ error: 'Map not found' });

    // Fetch work centers ordered by name
    const workCenters = await (prisma as any).workCenter.findMany({
      where: { companyId: user.companyId, isActive: true, deletedAt: null },
      orderBy: { name: 'asc' },
    });

    if (workCenters.length === 0) {
      return reply.status(422).send({ error: 'No active work centers found to promote from.' });
    }

    // Gather average cycle time per work center from completed time entries
    const avgTimes: Record<string, number | null> = {};
    for (const wc of workCenters) {
      const entries = await (prisma as any).jobTimeEntry.findMany({
        where: { workCenterId: wc.id, companyId: user.companyId, eventType: 'CHECK_OUT' },
        take: 50,
        orderBy: { scannedAt: 'desc' },
      });
      // Each CHECK_OUT paired with its CHECK_IN gives duration — simplified: use count * avg session ~= not reliable without pairs
      // Instead just leave null for promoted nodes; users can fill in from knowledge
      avgTimes[wc.id] = null;
    }

    // Determine next available position
    const existingCount = map.nodes.length;

    // Build nodes: SUPPLIER at 0, then each work center, then SHIPPING, then CUSTOMER
    const nodesToCreate: Array<{
      mapId: string;
      type: string;
      label: string;
      position: number;
      promotedFromId: string | null;
      updatedAt: Date;
    }> = [];

    let pos = existingCount;

    // If no nodes yet, add Supplier and Raw Material store first
    if (existingCount === 0) {
      nodesToCreate.push({
        mapId: id, type: 'SUPPLIER', label: 'Supplier',
        position: pos++, promotedFromId: null, updatedAt: new Date(),
      });
      nodesToCreate.push({
        mapId: id, type: 'INVENTORY', label: 'Raw Material Store',
        position: pos++, promotedFromId: null, updatedAt: new Date(),
      });
    }

    // Work center process nodes
    for (const wc of workCenters) {
      nodesToCreate.push({
        mapId: id,
        type: 'PROCESS',
        label: wc.name,
        position: pos++,
        promotedFromId: wc.id,
        updatedAt: new Date(),
      });
    }

    // If no nodes yet, also add FG store, Shipping, Customer
    if (existingCount === 0) {
      nodesToCreate.push({
        mapId: id, type: 'INVENTORY', label: 'Finished Goods Store',
        position: pos++, promotedFromId: null, updatedAt: new Date(),
      });
      nodesToCreate.push({
        mapId: id, type: 'SHIPPING', label: 'Shipping / Dispatch',
        position: pos++, promotedFromId: null, updatedAt: new Date(),
      });
      nodesToCreate.push({
        mapId: id, type: 'CUSTOMER', label: 'Customer',
        position: pos++, promotedFromId: null, updatedAt: new Date(),
      });
    }

    await (prisma as any).vSMNode.createMany({ data: nodesToCreate });

    await (prisma as any).valueStreamMap.update({
      where: { id },
      data: { updatedAt: new Date(), updatedBy: user.sub },
    });

    const updatedMap = await (prisma as any).valueStreamMap.findFirst({
      where: { id },
      include: { nodes: { orderBy: { position: 'asc' } } },
    });

    emitToCompany(user.companyId, 'VSM_UPDATE', { mapId: id, action: 'MAP_PROMOTED', map: updatedMap });
    return updatedMap;
  });

  // ── POST /vsm/:id/analyze — AI lean analysis via Anthropic ─────────────────
  fastify.post('/:id/analyze', async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = (request as any).user;

    if (!process.env.ANTHROPIC_API_KEY) {
      return reply.status(503).send({ error: 'AI analysis not configured — set ANTHROPIC_API_KEY in the environment.' });
    }

    const map = await (prisma as any).valueStreamMap.findFirst({
      where: { id, companyId: user.companyId, deletedAt: null },
      include: { nodes: { orderBy: { position: 'asc' } } },
    });
    if (!map) return reply.status(404).send({ error: 'Map not found' });

    const nodes = map.nodes as Array<{
      type: string; label: string; position: number;
      cycleTimeSec: number | null; changeOverSec: number | null;
      uptimePct: number | null; operatorCount: number | null;
      batchSize: number | null; waitTimeSec: number | null; notes: string | null;
    }>;

    if (nodes.length === 0) {
      return reply.status(422).send({ error: 'Add nodes to the map before running analysis.' });
    }

    // Build a structured description of the VSM for the AI
    function fmtSec(s: number | null) { if (s == null) return null; if (s < 60) return `${s}s`; if (s < 3600) return `${Math.round(s/60)}m`; return `${(s/3600).toFixed(1)}h`; }

    const nodeDescriptions = nodes.map((n, i) =>
      `${i + 1}. [${n.type}] ${n.label}` +
      (n.cycleTimeSec  != null ? ` | C/T: ${fmtSec(n.cycleTimeSec)}`   : '') +
      (n.changeOverSec != null ? ` | C/O: ${fmtSec(n.changeOverSec)}`  : '') +
      (n.uptimePct     != null ? ` | Uptime: ${n.uptimePct}%`          : '') +
      (n.operatorCount != null ? ` | Operators: ${n.operatorCount}`     : '') +
      (n.batchSize     != null ? ` | Batch: ${n.batchSize}`            : '') +
      (n.waitTimeSec   != null ? ` | Wait before: ${fmtSec(n.waitTimeSec)}` : '')
    ).join('\n');

    const procNodes = nodes.filter((n) => n.type === 'PROCESS' || n.type === 'SHIPPING');
    const totalCycle = procNodes.reduce((s, n) => s + (n.cycleTimeSec ?? 0), 0);
    const totalWait  = nodes.reduce((s, n) => s + (n.waitTimeSec ?? 0), 0);
    const totalLead  = totalCycle + totalWait;
    const efficiency = totalLead > 0 ? ((totalCycle / totalLead) * 100).toFixed(1) : null;

    const systemPrompt = `You are a lean manufacturing expert and value stream mapping (VSM) specialist with deep experience in metal service centers, fabrication, and industrial manufacturing.
Analyze the provided Value Stream Map data and deliver a structured, actionable assessment.
Format your response using clear sections with headers. Be specific, practical, and quantitative where possible.`;

    const userPrompt = `Value Stream Map: "${map.name}"

PROCESS FLOW (in sequence):
${nodeDescriptions}

CALCULATED METRICS:
- Total Lead Time: ${fmtSec(totalLead) ?? '—'}
- Total Value-Added (Cycle) Time: ${fmtSec(totalCycle) ?? '—'}
- Total Wait/Queue Time: ${fmtSec(totalWait) ?? '—'}
- Flow Efficiency: ${efficiency ? `${efficiency}%` : 'insufficient data'}

Please provide:

## 1. Current State Assessment
Summarise the key characteristics of this value stream — what the flow looks like, major steps, and overall performance indicators.

## 2. Waste Identification (8 Wastes of Lean)
Identify specific wastes visible in this VSM: overproduction, waiting, transport, over-processing, inventory, motion, defects, and unused talent/skills.

## 3. Bottleneck Analysis
Identify the primary constraint(s) — processes with the highest cycle time, lowest uptime, or most wait time upstream. Explain why these are limiting throughput.

## 4. Flow Efficiency Commentary
Comment on the ${efficiency ? `${efficiency}%` : 'unknown'} flow efficiency. Is it typical for this type of operation? What is a realistic improvement target?

## 5. Priority Recommendations
Provide 3–5 specific, prioritised improvement actions. For each, include:
- The specific issue or opportunity
- The recommended countermeasure
- Expected impact (time/cost/quality)

## 6. Future State Suggestions
Describe what the future state VSM should look like — which steps to combine, eliminate, or streamline. Include any lean tools that would help (e.g. kanban, SMED, OEE improvement, flow balancing).`;

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    function sse(data: object) {
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    }

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    try {
      const stream = await client.messages.stream({
        model: 'claude-opus-4-6',
        max_tokens: 2048,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      });

      let fullText = '';
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          fullText += event.delta.text;
          sse({ type: 'chunk', chunk: event.delta.text });
        }
      }

      sse({ type: 'done', text: fullText });
    } catch (err) {
      sse({ type: 'error', error: err instanceof Error ? err.message : 'Analysis failed' });
      fastify.log.error(err, 'VSM AI analysis error');
    }

    reply.raw.end();
  });
};

export default valuestream;
