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

  // ── POST /vsm/seed-examples — load 5 steel industry VSM examples ───────────
  fastify.post('/seed-examples', async (request, reply) => {
    const user = (request as any).user;
    const companyId = user.companyId;

    // Helper: encode (x,y) position + extra metrics into the notes field
    function mkNotes(x: number, y: number, extras: string[]): string {
      const prefix = `{"_x":${x},"_y":${y}}`;
      const tail = extras.join(' · ');
      return tail ? `${prefix} ${tail}` : prefix;
    }

    type N = {
      type: 'SUPPLIER' | 'PROCESS' | 'INVENTORY' | 'SHIPPING' | 'CUSTOMER';
      label: string;
      position: number;
      cycleTimeSec: number | null;
      changeOverSec: number | null;
      uptimePct: number | null;
      operatorCount: number | null;
      batchSize: number | null;
      waitTimeSec: number | null;
      notes: string;
    };

    interface ExampleMap {
      name: string;
      description: string;
      nodes: N[];
    }

    const Y_EXT = 40;   // y for external (supplier/customer) nodes
    const Y_PROC = 180;  // y for process nodes
    const Y_INV = 340;   // y for inventory nodes
    const X_GAP = 260;   // horizontal spacing

    const examples: ExampleMap[] = [
      // ─── VSM 1: Order to Delivery ─────────────────────────────────────────
      {
        name: 'Order to Delivery',
        description: 'Customer order fulfilment end-to-end',
        nodes: [
          { type: 'CUSTOMER', label: 'Customer', position: 0, cycleTimeSec: null, changeOverSec: null, uptimePct: null, operatorCount: null, batchSize: null, waitTimeSec: null, notes: mkNotes(60, Y_EXT, ['Demand: 120t/wk', 'Orders: Daily EDI']) },
          { type: 'PROCESS', label: 'Sales & Order Entry', position: 1, cycleTimeSec: 2700, changeOverSec: null, uptimePct: 99, operatorCount: 1, batchSize: null, waitTimeSec: null, notes: mkNotes(60 + X_GAP, Y_PROC, ['Shifts: 1']) },
          { type: 'PROCESS', label: 'AI Demand Planning', position: 2, cycleTimeSec: null, changeOverSec: null, uptimePct: null, operatorCount: null, batchSize: null, waitTimeSec: null, notes: mkNotes(60 + X_GAP * 2, Y_PROC, ['C/T: Auto', 'ML Model: v3.1', 'Accuracy: 94%', '🤖 AI']) },
          { type: 'INVENTORY', label: 'Order Queue', position: 3, cycleTimeSec: null, changeOverSec: null, uptimePct: null, operatorCount: null, batchSize: null, waitTimeSec: 21600, notes: mkNotes(60 + X_GAP * 3, Y_INV, ['WIP: 42 orders']) },
          { type: 'PROCESS', label: 'Warehouse Pick', position: 4, cycleTimeSec: 7560, changeOverSec: null, uptimePct: 91, operatorCount: 2, batchSize: null, waitTimeSec: null, notes: mkNotes(60 + X_GAP * 4, Y_PROC, ['Shifts: 2']) },
          { type: 'INVENTORY', label: 'Stock Buffer', position: 5, cycleTimeSec: null, changeOverSec: null, uptimePct: null, operatorCount: null, batchSize: null, waitTimeSec: null, notes: mkNotes(60 + X_GAP * 5, Y_INV, ['Stock: 280t', 'Turns: 18x']) },
          { type: 'PROCESS', label: 'QC & Cert Check', position: 6, cycleTimeSec: 2100, changeOverSec: null, uptimePct: null, operatorCount: null, batchSize: null, waitTimeSec: null, notes: mkNotes(60 + X_GAP * 6, Y_PROC, ['FPY: 98.2%', 'Digital cert']) },
          { type: 'INVENTORY', label: 'Staging', position: 7, cycleTimeSec: null, changeOverSec: null, uptimePct: null, operatorCount: null, batchSize: null, waitTimeSec: 7200, notes: mkNotes(60 + X_GAP * 7, Y_INV, ['WIP: 8t']) },
          { type: 'SHIPPING', label: 'Dispatch & 3PL', position: 8, cycleTimeSec: 5400, changeOverSec: null, uptimePct: null, operatorCount: null, batchSize: null, waitTimeSec: null, notes: mkNotes(60 + X_GAP * 8, Y_PROC, ['OTIF: 94%', 'API-linked 3PL']) },
          { type: 'SUPPLIER', label: 'Mill Supplier', position: 9, cycleTimeSec: null, changeOverSec: null, uptimePct: null, operatorCount: null, batchSize: null, waitTimeSec: null, notes: mkNotes(60 + X_GAP * 4, Y_EXT - 120, ['Lead: 21 days', 'MOQ: 10t', 'EDI: Yes']) },
        ],
      },

      // ─── VSM 2: Procurement & Replenishment ───────────────────────────────
      {
        name: 'Procurement & Replenishment',
        description: 'Supplier relationship & stock optimisation',
        nodes: [
          { type: 'CUSTOMER', label: 'Demand Signal', position: 0, cycleTimeSec: null, changeOverSec: null, uptimePct: null, operatorCount: null, batchSize: null, waitTimeSec: null, notes: mkNotes(60, Y_EXT, ['AI forecast', '4-wk horizon', 'SKU: 1,240']) },
          { type: 'PROCESS', label: 'MRP / ERP Engine', position: 1, cycleTimeSec: null, changeOverSec: null, uptimePct: null, operatorCount: null, batchSize: null, waitTimeSec: null, notes: mkNotes(60 + X_GAP, Y_PROC, ['Run: Real-time', 'Auto PO: 70%', 'Exception mgmt']) },
          { type: 'PROCESS', label: 'PO Approval', position: 2, cycleTimeSec: 14400, changeOverSec: null, uptimePct: null, operatorCount: null, batchSize: null, waitTimeSec: null, notes: mkNotes(60 + X_GAP * 2, Y_PROC, ['Threshold: $10k', 'Digital sign-off']) },
          { type: 'INVENTORY', label: 'Open PO Queue', position: 3, cycleTimeSec: null, changeOverSec: null, uptimePct: null, operatorCount: null, batchSize: null, waitTimeSec: null, notes: mkNotes(60 + X_GAP * 3, Y_INV, ['POs: 38', 'Value: $2.1M']) },
          { type: 'PROCESS', label: 'Supplier Portal', position: 4, cycleTimeSec: null, changeOverSec: null, uptimePct: null, operatorCount: null, batchSize: null, waitTimeSec: null, notes: mkNotes(60 + X_GAP * 4, Y_PROC, ['Suppliers: 28', 'Portal: Live', 'Ack: <2 hrs']) },
          { type: 'SUPPLIER', label: 'Steel Mills', position: 5, cycleTimeSec: null, changeOverSec: null, uptimePct: null, operatorCount: null, batchSize: null, waitTimeSec: null, notes: mkNotes(60 + X_GAP * 4, Y_EXT - 120, ['3 preferred', 'Mill cert API', 'Grade: AS/NZS']) },
          { type: 'INVENTORY', label: 'In Transit', position: 6, cycleTimeSec: null, changeOverSec: null, uptimePct: null, operatorCount: null, batchSize: null, waitTimeSec: null, notes: mkNotes(60 + X_GAP * 5, Y_INV, ['Volume: 140t', 'Tracked: GPS']) },
          { type: 'PROCESS', label: 'Goods Receiving', position: 7, cycleTimeSec: 12600, changeOverSec: null, uptimePct: null, operatorCount: null, batchSize: null, waitTimeSec: null, notes: mkNotes(60 + X_GAP * 6, Y_PROC, ['Digital GRN', 'QR scanning']) },
          { type: 'INVENTORY', label: 'Receiving Bay', position: 8, cycleTimeSec: null, changeOverSec: null, uptimePct: null, operatorCount: null, batchSize: null, waitTimeSec: 21600, notes: mkNotes(60 + X_GAP * 7, Y_INV, ['WIP: 22t']) },
          { type: 'PROCESS', label: 'WMS Put-away', position: 9, cycleTimeSec: 4320, changeOverSec: null, uptimePct: null, operatorCount: null, batchSize: null, waitTimeSec: null, notes: mkNotes(60 + X_GAP * 8, Y_PROC, ['WMS-guided', 'RFID tracked']) },
        ],
      },

      // ─── VSM 3: Cut-to-Length Processing ──────────────────────────────────
      {
        name: 'Cut-to-Length Processing',
        description: 'Value-add steel processing & transformation',
        nodes: [
          { type: 'CUSTOMER', label: 'Sales Order', position: 0, cycleTimeSec: null, changeOverSec: null, uptimePct: null, operatorCount: null, batchSize: null, waitTimeSec: null, notes: mkNotes(60, Y_EXT, ['Spec: DXF/PDF', 'Custom: 63%', 'Urgent: 18%']) },
          { type: 'PROCESS', label: 'AI Nesting Software', position: 1, cycleTimeSec: 480, changeOverSec: null, uptimePct: null, operatorCount: null, batchSize: null, waitTimeSec: null, notes: mkNotes(60 + X_GAP, Y_PROC, ['Yield: 94.2%', 'Auto-optimised', '🤖 AI']) },
          { type: 'INVENTORY', label: 'Job Queue', position: 2, cycleTimeSec: null, changeOverSec: null, uptimePct: null, operatorCount: null, batchSize: null, waitTimeSec: 2700, notes: mkNotes(60 + X_GAP * 2, Y_INV, ['Jobs: 14']) },
          { type: 'PROCESS', label: 'Material Issue', position: 3, cycleTimeSec: 1500, changeOverSec: null, uptimePct: null, operatorCount: null, batchSize: null, waitTimeSec: null, notes: mkNotes(60 + X_GAP * 3, Y_PROC, ['WMS pick', 'Bar code scan']) },
          { type: 'SUPPLIER', label: 'Raw Stock', position: 4, cycleTimeSec: null, changeOverSec: null, uptimePct: null, operatorCount: null, batchSize: null, waitTimeSec: null, notes: mkNotes(60 + X_GAP * 3, Y_EXT - 120, ['Plate/coil/bar', 'RFID tagged', 'WMS location']) },
          { type: 'PROCESS', label: 'Plasma/Laser Cut', position: 5, cycleTimeSec: 2700, changeOverSec: null, uptimePct: 81, operatorCount: 2, batchSize: null, waitTimeSec: null, notes: mkNotes(60 + X_GAP * 4, Y_PROC, ['OEE: 81%', '2 machines']) },
          { type: 'INVENTORY', label: 'Cut WIP', position: 6, cycleTimeSec: null, changeOverSec: null, uptimePct: null, operatorCount: null, batchSize: null, waitTimeSec: 1800, notes: mkNotes(60 + X_GAP * 5, Y_INV, ['WIP: 4t']) },
          { type: 'PROCESS', label: 'Deburr & Finish', position: 7, cycleTimeSec: 1200, changeOverSec: null, uptimePct: null, operatorCount: null, batchSize: null, waitTimeSec: null, notes: mkNotes(60 + X_GAP * 6, Y_PROC, ['Auto: 60%', 'FPY: 97%']) },
          { type: 'INVENTORY', label: 'Finish Hold', position: 8, cycleTimeSec: null, changeOverSec: null, uptimePct: null, operatorCount: null, batchSize: null, waitTimeSec: 1200, notes: mkNotes(60 + X_GAP * 7, Y_INV, ['WIP: 1.8t']) },
          { type: 'PROCESS', label: 'Pack & Label', position: 9, cycleTimeSec: 900, changeOverSec: null, uptimePct: null, operatorCount: null, batchSize: null, waitTimeSec: null, notes: mkNotes(60 + X_GAP * 8, Y_PROC, ['QR cert label', 'Spec verified']) },
        ],
      },

      // ─── VSM 4: Quote to Cash ─────────────────────────────────────────────
      {
        name: 'Quote to Cash',
        description: 'Commercial cycle from inquiry to payment',
        nodes: [
          { type: 'CUSTOMER', label: 'Customer Inquiry', position: 0, cycleTimeSec: null, changeOverSec: null, uptimePct: null, operatorCount: null, batchSize: null, waitTimeSec: null, notes: mkNotes(60, Y_EXT, ['Channel: Web/Phone', 'Volume: 65/day', 'Avg: $12k']) },
          { type: 'PROCESS', label: 'AI Quote Engine', position: 1, cycleTimeSec: 720, changeOverSec: null, uptimePct: null, operatorCount: null, batchSize: null, waitTimeSec: null, notes: mkNotes(60 + X_GAP, Y_PROC, ['Auto: 78%', 'Accuracy: 96%', '🤖 AI']) },
          { type: 'INVENTORY', label: 'Quote Queue', position: 2, cycleTimeSec: null, changeOverSec: null, uptimePct: null, operatorCount: null, batchSize: null, waitTimeSec: null, notes: mkNotes(60 + X_GAP * 2, Y_INV, ['Open: 28', 'Avg age: 1.8d']) },
          { type: 'PROCESS', label: 'Quote Approval', position: 3, cycleTimeSec: 7200, changeOverSec: null, uptimePct: null, operatorCount: null, batchSize: null, waitTimeSec: null, notes: mkNotes(60 + X_GAP * 3, Y_PROC, ['Threshold: $50k', 'Digital workflow']) },
          { type: 'PROCESS', label: 'Order Confirmation', position: 4, cycleTimeSec: 1800, changeOverSec: null, uptimePct: null, operatorCount: null, batchSize: null, waitTimeSec: null, notes: mkNotes(60 + X_GAP * 4, Y_PROC, ['ERP auto-create', 'CRM linked']) },
          { type: 'INVENTORY', label: 'Order Backlog', position: 5, cycleTimeSec: null, changeOverSec: null, uptimePct: null, operatorCount: null, batchSize: null, waitTimeSec: null, notes: mkNotes(60 + X_GAP * 5, Y_INV, ['Orders: 142', 'Value: $1.8M']) },
          { type: 'PROCESS', label: 'Auto Invoicing', position: 6, cycleTimeSec: 300, changeOverSec: null, uptimePct: null, operatorCount: null, batchSize: null, waitTimeSec: null, notes: mkNotes(60 + X_GAP * 6, Y_PROC, ['eInvoice: 91%', 'PEPPOL ready']) },
          { type: 'INVENTORY', label: 'Invoice Queue', position: 7, cycleTimeSec: null, changeOverSec: null, uptimePct: null, operatorCount: null, batchSize: null, waitTimeSec: null, notes: mkNotes(60 + X_GAP * 7, Y_INV, ['Pending: 18', 'Value: $340k']) },
          { type: 'PROCESS', label: 'AR & Collections', position: 8, cycleTimeSec: null, changeOverSec: null, uptimePct: null, operatorCount: null, batchSize: null, waitTimeSec: null, notes: mkNotes(60 + X_GAP * 8, Y_PROC, ['DSO: 34 days', 'Auto chase: On', 'Portal: Live']) },
          { type: 'SUPPLIER', label: 'Market Pricing', position: 9, cycleTimeSec: null, changeOverSec: null, uptimePct: null, operatorCount: null, batchSize: null, waitTimeSec: null, notes: mkNotes(60 + X_GAP, Y_EXT - 120, ['LME feed: Live', 'Margin model', 'Competitor intel']) },
        ],
      },

      // ─── VSM 5: Returns & Non-Conformance ─────────────────────────────────
      {
        name: 'Returns & Non-Conformance',
        description: 'Quality loop, RMA and corrective action',
        nodes: [
          { type: 'CUSTOMER', label: 'Customer Return', position: 0, cycleTimeSec: null, changeOverSec: null, uptimePct: null, operatorCount: null, batchSize: null, waitTimeSec: null, notes: mkNotes(60, Y_EXT, ['Rate: 1.4%', 'Digital RMA', 'Photo upload']) },
          { type: 'PROCESS', label: 'RMA Processing', position: 1, cycleTimeSec: 3600, changeOverSec: null, uptimePct: null, operatorCount: null, batchSize: null, waitTimeSec: null, notes: mkNotes(60 + X_GAP, Y_PROC, ['Auto-classify', 'Root cause tag']) },
          { type: 'INVENTORY', label: 'Returned Goods', position: 2, cycleTimeSec: null, changeOverSec: null, uptimePct: null, operatorCount: null, batchSize: null, waitTimeSec: null, notes: mkNotes(60 + X_GAP * 2, Y_INV, ['WIP: 6t', 'Quarantine bay']) },
          { type: 'PROCESS', label: 'QC Inspection', position: 3, cycleTimeSec: 9000, changeOverSec: null, uptimePct: null, operatorCount: null, batchSize: null, waitTimeSec: null, notes: mkNotes(60 + X_GAP * 3, Y_PROC, ['Digital report', 'Photo evidence']) },
          { type: 'INVENTORY', label: 'Awaiting Decision', position: 4, cycleTimeSec: null, changeOverSec: null, uptimePct: null, operatorCount: null, batchSize: null, waitTimeSec: 120960, notes: mkNotes(60 + X_GAP * 4, Y_INV, ['Hold: 3.2t']) },
          { type: 'PROCESS', label: 'Disposition Decision', position: 5, cycleTimeSec: null, changeOverSec: null, uptimePct: null, operatorCount: null, batchSize: null, waitTimeSec: null, notes: mkNotes(60 + X_GAP * 5, Y_PROC, ['Restock: 42%', 'Rework: 31%', 'Scrap: 27%']) },
          { type: 'PROCESS', label: 'CAPA Workflow', position: 6, cycleTimeSec: 259200, changeOverSec: null, uptimePct: null, operatorCount: null, batchSize: null, waitTimeSec: null, notes: mkNotes(60 + X_GAP * 6, Y_PROC, ['Closed: 89%', '8D format']) },
          { type: 'INVENTORY', label: 'CAPA Open Items', position: 7, cycleTimeSec: null, changeOverSec: null, uptimePct: null, operatorCount: null, batchSize: null, waitTimeSec: null, notes: mkNotes(60 + X_GAP * 7, Y_INV, ['Items: 12', 'Overdue: 2']) },
          { type: 'PROCESS', label: 'Credit / Resolution', position: 8, cycleTimeSec: 14400, changeOverSec: null, uptimePct: null, operatorCount: null, batchSize: null, waitTimeSec: null, notes: mkNotes(60 + X_GAP * 8, Y_PROC, ['Auto credit: 65%', 'NPS tracked']) },
          { type: 'SUPPLIER', label: 'Supplier NCR', position: 9, cycleTimeSec: null, changeOverSec: null, uptimePct: null, operatorCount: null, batchSize: null, waitTimeSec: null, notes: mkNotes(60 + X_GAP * 6, Y_EXT - 120, ['Rate: 0.8%', 'Scorecard live', 'Penalty clause']) },
        ],
      },
    ];

    // Create all 5 maps with their nodes in a transaction
    const created = await (prisma as any).$transaction(async (tx: any) => {
      const results = [];
      for (const ex of examples) {
        const map = await tx.valueStreamMap.create({
          data: {
            companyId,
            name: ex.name,
            description: ex.description,
            createdBy: user.sub,
            updatedAt: new Date(),
          },
        });
        const nodeData = ex.nodes.map((n) => ({
          mapId: map.id,
          type: n.type,
          label: n.label,
          position: n.position,
          cycleTimeSec: n.cycleTimeSec,
          changeOverSec: n.changeOverSec,
          uptimePct: n.uptimePct,
          operatorCount: n.operatorCount,
          batchSize: n.batchSize,
          waitTimeSec: n.waitTimeSec,
          notes: n.notes,
          updatedAt: new Date(),
        }));
        await tx.vSMNode.createMany({ data: nodeData });
        const full = await tx.valueStreamMap.findFirst({
          where: { id: map.id },
          include: { nodes: { orderBy: { position: 'asc' } } },
        });
        results.push(full);
      }
      return results;
    });

    // Emit update event for each new map
    for (const map of created) {
      emitToCompany(companyId, 'VSM_UPDATE', { mapId: map.id, action: 'MAP_CREATED', map });
    }

    return reply.status(201).send(created);
  });
};

export default valuestream;
