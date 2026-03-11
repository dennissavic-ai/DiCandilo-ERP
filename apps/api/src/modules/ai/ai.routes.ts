import { FastifyPluginAsync } from 'fastify';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { prisma } from '../../config/database';
import { authenticate } from '../../middleware/auth.middleware';

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an intelligent ERP assistant for DiCandilo Metal Service Center.
You have full access to the business and can look up information, create documents, and answer questions across every module.

Capabilities:
- Sales: create quotes, look up customers and their account status, check open quotes and sales orders
- Inventory: search the product library, check live stock levels
- Finance: report overdue invoices, view AR exposure, business KPIs
- General: answer questions about anything in the business using the tools

Rules:
- Always use tools to look up real data — never invent IDs, prices, or stock levels.
- Prices come from listPrice in the product record. Never fabricate a price.
- Be concise and action-oriented. Summarise results clearly.
- When creating documents (quotes, orders), confirm the key details in your response.
- If a request is ambiguous, ask one clarifying question rather than guessing.`;

// ── Tool definitions ──────────────────────────────────────────────────────────

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'search_customers',
    description: 'Search for customers by name or code. Returns id, code, name, currency and credit terms.',
    input_schema: { type: 'object' as const, properties: { query: { type: 'string' } }, required: ['query'] },
  },
  {
    name: 'get_customer_summary',
    description: 'Get full account summary for a customer: credit limit/hold status, open AR balance, open quotes, open sales orders.',
    input_schema: { type: 'object' as const, properties: { customerId: { type: 'string', description: 'Customer UUID' } }, required: ['customerId'] },
  },
  {
    name: 'search_products',
    description: 'Search the product library by code, description, grade, material type or dimensions. Returns up to 8 products with list prices.',
    input_schema: { type: 'object' as const, properties: { query: { type: 'string' } }, required: ['query'] },
  },
  {
    name: 'check_stock',
    description: 'Check current available inventory levels for a product. Returns stock by location.',
    input_schema: { type: 'object' as const, properties: { productQuery: { type: 'string', description: 'Product code or description to search' } }, required: ['productQuery'] },
  },
  {
    name: 'search_quotes',
    description: 'Search existing sales quotes by customer name, quote number, or status.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query:  { type: 'string', description: 'Customer name or quote number keyword' },
        status: { type: 'string', description: 'Optional status filter: DRAFT, SENT, ACCEPTED, DECLINED, EXPIRED, CONVERTED' },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_sales_orders',
    description: 'Search sales orders by customer name, order number, or status.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query:  { type: 'string', description: 'Customer name or order number keyword' },
        status: { type: 'string', description: 'Optional status filter: PENDING, CONFIRMED, PROCESSING, SHIPPED, INVOICED, CANCELLED' },
      },
      required: ['query'],
    },
  },
  {
    name: 'list_overdue_invoices',
    description: 'List all overdue invoices (past due date, not paid). Returns customer, invoice number, amount, and days overdue.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'get_business_snapshot',
    description: 'Get a high-level business snapshot: open quotes count/value, open sales orders, revenue this month, overdue AR total.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'create_quote',
    description: 'Create a draft quote for a customer.',
    input_schema: {
      type: 'object' as const,
      properties: {
        customerId: { type: 'string' },
        currency:   { type: 'string', default: 'AUD' },
        notes:      { type: 'string' },
        lines: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              productId:   { type: 'string' },
              description: { type: 'string' },
              qty:         { type: 'integer', default: 1 },
              uom:         { type: 'string',  default: 'EA' },
              unitPrice:   { type: 'integer', description: 'Cents' },
              discountPct: { type: 'number',  default: 0 },
            },
            required: ['description', 'qty', 'uom', 'unitPrice'],
          },
        },
      },
      required: ['customerId', 'lines'],
    },
  },
];

// ── Tool executors ────────────────────────────────────────────────────────────

async function searchCustomers(companyId: string, query: string) {
  return prisma.customer.findMany({
    where: { companyId, deletedAt: null, isActive: true,
      OR: [{ name: { contains: query, mode: 'insensitive' } }, { code: { contains: query, mode: 'insensitive' } }],
    },
    take: 5,
    select: { id: true, code: true, name: true, creditTerms: true, currencyCode: true },
  });
}

async function getCustomerSummary(companyId: string, customerId: string) {
  const [customer, arResult, openQuotes, openOrders] = await Promise.all([
    prisma.customer.findFirst({
      where: { id: customerId, companyId },
      select: { id: true, code: true, name: true, creditLimit: true, creditHold: true, creditTerms: true, currencyCode: true },
    }),
    prisma.invoice.aggregate({
      where: { customerId, companyId, status: { notIn: ['PAID', 'CANCELLED', 'WRITTEN_OFF'] }, deletedAt: null },
      _sum: { balanceDue: true },
      _count: true,
    }),
    prisma.salesQuote.aggregate({
      where: { customerId, companyId, status: { notIn: ['EXPIRED', 'CONVERTED'] }, deletedAt: null },
      _sum: { totalAmount: true }, _count: true,
    }),
    prisma.salesOrder.aggregate({
      where: { customerId, companyId, status: { notIn: ['CANCELLED', 'INVOICED', 'CLOSED'] }, deletedAt: null },
      _sum: { totalAmount: true }, _count: true,
    }),
  ]);
  return {
    customer,
    openAR:      { count: arResult._count,    totalCents: Number(arResult._sum?.balanceDue   ?? 0) },
    openQuotes:  { count: openQuotes._count,  totalCents: Number(openQuotes._sum?.totalAmount ?? 0) },
    openOrders:  { count: openOrders._count,  totalCents: Number(openOrders._sum?.totalAmount ?? 0) },
  };
}

async function searchProducts(companyId: string, query: string) {
  const results = await prisma.product.findMany({
    where: { companyId, deletedAt: null, isActive: true,
      OR: [
        { code:            { contains: query, mode: 'insensitive' } },
        { description:     { contains: query, mode: 'insensitive' } },
        { grade:           { contains: query, mode: 'insensitive' } },
        { materialType:    { contains: query, mode: 'insensitive' } },
        { longDescription: { contains: query, mode: 'insensitive' } },
      ],
    },
    take: 8,
    select: { id: true, code: true, description: true, uom: true, listPrice: true, materialType: true, grade: true, shape: true },
  });
  return results.map((p) => ({ ...p, listPrice: Number(p.listPrice) }));
}

async function checkStock(companyId: string, productQuery: string) {
  const products = await searchProducts(companyId, productQuery);
  if (products.length === 0) return { found: false, products: [] };
  const productIds = products.map((p) => p.id);
  const stock = await prisma.inventoryItem.groupBy({
    by: ['productId'],
    where: { product: { companyId }, productId: { in: productIds }, isActive: true, deletedAt: null },
    _sum: { qtyAvailable: true },
  });
  return products.map((p) => ({
    ...p,
    qtyAvailable: Number(stock.find((s) => s.productId === p.id)?._sum.qtyAvailable ?? 0),
  }));
}

async function searchQuotes(companyId: string, query: string, status?: string) {
  const results = await prisma.salesQuote.findMany({
    where: {
      companyId, deletedAt: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(status && { status: status as any }),
      OR: [
        { quoteNumber:          { contains: query, mode: 'insensitive' } },
        { customer: { name:     { contains: query, mode: 'insensitive' } } },
        { customer: { code:     { contains: query, mode: 'insensitive' } } },
      ],
    },
    take: 8,
    orderBy: { createdAt: 'desc' },
    select: { id: true, quoteNumber: true, status: true, totalAmount: true, validUntil: true, customer: { select: { name: true, code: true } } },
  });
  return results.map((q) => ({ ...q, totalAmount: Number(q.totalAmount) }));
}

async function searchSalesOrders(companyId: string, query: string, status?: string) {
  const results = await prisma.salesOrder.findMany({
    where: {
      companyId, deletedAt: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(status && { status: status as any }),
      OR: [
        { orderNumber:          { contains: query, mode: 'insensitive' } },
        { customer: { name:     { contains: query, mode: 'insensitive' } } },
        { customer: { code:     { contains: query, mode: 'insensitive' } } },
        { customerPoNumber:     { contains: query, mode: 'insensitive' } },
      ],
    },
    take: 8,
    orderBy: { createdAt: 'desc' },
    select: { id: true, orderNumber: true, status: true, totalAmount: true, requiredDate: true, customer: { select: { name: true, code: true } } },
  });
  return results.map((o) => ({ ...o, totalAmount: Number(o.totalAmount) }));
}

async function listOverdueInvoices(companyId: string) {
  const now = new Date();
  const results = await prisma.invoice.findMany({
    where: { companyId, deletedAt: null, dueDate: { lt: now }, status: { notIn: ['PAID', 'CANCELLED', 'WRITTEN_OFF'] } },
    orderBy: { dueDate: 'asc' },
    take: 20,
    select: { id: true, invoiceNumber: true, dueDate: true, balanceDue: true, customer: { select: { name: true, code: true } } },
  });
  return results.map((inv) => ({
    ...inv,
    balanceDue:  Number(inv.balanceDue),
    daysOverdue: Math.floor((now.getTime() - inv.dueDate.getTime()) / 86_400_000),
  }));
}

async function getBusinessSnapshot(companyId: string) {
  const now       = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [openQuotes, openOrders, monthRevenue, overdueAR] = await Promise.all([
    prisma.salesQuote.aggregate({
      where: { companyId, deletedAt: null, status: { notIn: ['EXPIRED', 'CONVERTED'] } },
      _sum: { totalAmount: true }, _count: true,
    }),
    prisma.salesOrder.aggregate({
      where: { companyId, deletedAt: null, status: { notIn: ['CANCELLED', 'INVOICED', 'CLOSED'] } },
      _sum: { totalAmount: true }, _count: true,
    }),
    prisma.salesOrder.aggregate({
      where: { companyId, deletedAt: null, status: 'INVOICED', createdAt: { gte: monthStart } },
      _sum: { totalAmount: true },
    }),
    prisma.invoice.aggregate({
      where: { companyId, deletedAt: null, dueDate: { lt: now }, status: { notIn: ['PAID', 'CANCELLED', 'WRITTEN_OFF'] } },
      _sum: { balanceDue: true }, _count: true,
    }),
  ]);

  return {
    openQuotes:    { count: openQuotes._count,  valueCents: Number(openQuotes._sum?.totalAmount ?? 0) },
    openOrders:    { count: openOrders._count,  valueCents: Number(openOrders._sum?.totalAmount ?? 0) },
    monthRevenue:  { valueCents: Number(monthRevenue._sum?.totalAmount ?? 0) },
    overdueAR:     { count: overdueAR._count,   valueCents: Number(overdueAR._sum?.balanceDue  ?? 0) },
  };
}

async function createQuote(companyId: string, branchId: string, userId: string, input: {
  customerId: string; currency?: string; notes?: string;
  lines: { productId?: string; description: string; qty: number; uom: string; unitPrice: number; discountPct?: number }[];
}) {
  const count   = await prisma.salesQuote.count({ where: { companyId } });
  const quoteNumber = `Q-${String(count + 1).padStart(6, '0')}`;
  const subtotal = input.lines.reduce((s, l) => {
    const ls = l.qty * l.unitPrice;
    return s + ls - Math.round(ls * (l.discountPct ?? 0) / 100);
  }, 0);
  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + 30);

  const quote = await prisma.salesQuote.create({
    data: {
      companyId, branchId: branchId ?? '', customerId: input.customerId,
      quoteNumber, status: 'DRAFT', quoteDate: new Date(), validUntil,
      currencyCode: input.currency ?? 'AUD',
      subtotal, taxAmount: Math.round(subtotal * 0.1),
      totalAmount: subtotal + Math.round(subtotal * 0.1),
      notes: input.notes, createdBy: userId, updatedBy: userId,
      lines: {
        create: input.lines.map((l, i) => {
          const ls = l.qty * l.unitPrice;
          return { lineNumber: i + 1, productId: l.productId, description: l.description,
            uom: l.uom, qty: l.qty, unitPrice: l.unitPrice, discountPct: l.discountPct ?? 0,
            lineTotal: ls - Math.round(ls * (l.discountPct ?? 0) / 100) };
        }),
      },
    },
  });
  return { quoteId: quote.id, quoteNumber: quote.quoteNumber };
}

// ── SSE helper ────────────────────────────────────────────────────────────────

function sse(reply: { raw: { write: (s: string) => void } }, event: object) {
  reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
}

// ── Routes ────────────────────────────────────────────────────────────────────

export const aiRoutes: FastifyPluginAsync = async (fastify) => {

  /** Multi-turn ERP assistant — streams SSE events */
  fastify.post('/assistant', {
    schema: { tags: ['AI'] },
    preHandler: [authenticate],
  }, async (request, reply) => {
    const { companyId, branchId, sub } = request.user as { companyId: string; branchId: string; sub: string };

    const body = z.object({
      // Full conversation history from the client
      messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() })).min(1),
    }).parse(request.body);

    if (!process.env.ANTHROPIC_API_KEY) {
      return reply.status(503).send({ error: 'AI assistant not configured — set ANTHROPIC_API_KEY.' });
    }

    reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const messages: Anthropic.MessageParam[] = body.messages.map((m) => ({ role: m.role, content: m.content }));

    let finalText = '';

    try {
      let iterations = 0;
      while (iterations++ < 12) {
        const response = await client.messages.create({
          model: 'claude-opus-4-6',
          max_tokens: 4096,
          thinking: { type: 'adaptive' },
          system: SYSTEM_PROMPT,
          tools: TOOLS,
          messages,
        });

        // Collect text
        for (const block of response.content) {
          if (block.type === 'text' && block.text.trim()) finalText = block.text;
        }

        if (response.stop_reason === 'end_turn') break;

        const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
        if (toolUses.length === 0) break;

        messages.push({ role: 'assistant', content: response.content });
        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const tool of toolUses) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const inp = tool.input as any;
          let result: unknown;

          sse(reply, { type: 'tool', tool: tool.name, message: toolCallMessage(tool.name, inp) });

          try {
            if (tool.name === 'search_customers') {
              result = await searchCustomers(companyId, inp.query);
              sse(reply, { type: 'tool_result', tool: tool.name, message: `Found ${(result as []).length} customer(s)` });
            } else if (tool.name === 'get_customer_summary') {
              result = await getCustomerSummary(companyId, inp.customerId);
              sse(reply, { type: 'tool_result', tool: tool.name, message: `Loaded account summary` });
            } else if (tool.name === 'search_products') {
              result = await searchProducts(companyId, inp.query);
              sse(reply, { type: 'tool_result', tool: tool.name, message: `Found ${(result as []).length} product(s)` });
            } else if (tool.name === 'check_stock') {
              result = await checkStock(companyId, inp.productQuery);
              sse(reply, { type: 'tool_result', tool: tool.name, message: `Checked stock levels` });
            } else if (tool.name === 'search_quotes') {
              result = await searchQuotes(companyId, inp.query, inp.status);
              sse(reply, { type: 'tool_result', tool: tool.name, message: `Found ${(result as []).length} quote(s)` });
            } else if (tool.name === 'search_sales_orders') {
              result = await searchSalesOrders(companyId, inp.query, inp.status);
              sse(reply, { type: 'tool_result', tool: tool.name, message: `Found ${(result as []).length} order(s)` });
            } else if (tool.name === 'list_overdue_invoices') {
              result = await listOverdueInvoices(companyId);
              sse(reply, { type: 'tool_result', tool: tool.name, message: `Found ${(result as []).length} overdue invoice(s)` });
            } else if (tool.name === 'get_business_snapshot') {
              result = await getBusinessSnapshot(companyId);
              sse(reply, { type: 'tool_result', tool: tool.name, message: `Business snapshot loaded` });
            } else if (tool.name === 'create_quote') {
              const quote = await createQuote(companyId, branchId, sub, inp);
              result = quote;
              sse(reply, { type: 'action', action: 'quote_created', data: quote, message: `Quote ${quote.quoteNumber} created` });
            } else {
              result = { error: `Unknown tool: ${tool.name}` };
            }
          } catch (toolErr) {
            result = { error: toolErr instanceof Error ? toolErr.message : 'Tool error' };
            sse(reply, { type: 'tool_result', tool: tool.name, message: `Error: ${(result as { error: string }).error}` });
          }

          toolResults.push({ type: 'tool_result', tool_use_id: tool.id, content: JSON.stringify(result) });
        }

        messages.push({ role: 'user', content: toolResults });
      }

      sse(reply, { type: 'done', text: finalText });
    } catch (err) {
      sse(reply, { type: 'error', message: err instanceof Error ? err.message : 'Unknown error' });
      fastify.log.error(err, 'AI assistant error');
    }

    reply.raw.end();
  });

  // Register the AI schedule endpoint inside the same plugin
  await registerScheduleRoute(fastify);
};

function toolCallMessage(name: string, inp: Record<string, string>) {
  const map: Record<string, (i: typeof inp) => string> = {
    search_customers:    (i) => `Searching customers: "${i.query}"`,
    get_customer_summary:(i) => `Loading account summary…`,
    search_products:     (i) => `Searching products: "${i.query}"`,
    check_stock:         (i) => `Checking stock for "${i.productQuery}"`,
    search_quotes:       (i) => `Searching quotes: "${i.query}"`,
    search_sales_orders: (i) => `Searching orders: "${i.query}"`,
    list_overdue_invoices:()  => `Fetching overdue invoices…`,
    get_business_snapshot:()  => `Loading business snapshot…`,
    create_quote:        (i)  => `Creating quote (${(i.lines as unknown as [])?.length ?? '?'} lines)…`,
    // Scheduling tools
    get_schedulable_jobs:     () => `Loading jobs for scheduling…`,
    get_work_center_availability: (i) => `Checking availability for work center…`,
    create_schedule_blocks:   () => `Creating schedule blocks…`,
  };
  return map[name]?.(inp) ?? `Running ${name}…`;
}

// ── AI Schedule tools ──────────────────────────────────────────────────────────

const SCHEDULE_TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_schedulable_jobs',
    description: 'Fetch job plans with equipment requirements for the specified work orders. Returns plan details including equipment/work center requirements and estimated durations.',
    input_schema: {
      type: 'object' as const,
      properties: {
        workOrderIds: { type: 'array', items: { type: 'string' }, description: 'UUIDs of work orders to schedule' },
      },
      required: ['workOrderIds'],
    },
  },
  {
    name: 'get_work_center_availability',
    description: 'Check existing schedule blocks for a work center within a date window to identify free slots.',
    input_schema: {
      type: 'object' as const,
      properties: {
        workCenterId: { type: 'string', description: 'UUID of the work center' },
        fromDate:     { type: 'string', description: 'ISO datetime start of window (e.g. today)' },
        toDate:       { type: 'string', description: 'ISO datetime end of window (e.g. 14 days from today)' },
      },
      required: ['workCenterId', 'fromDate', 'toDate'],
    },
  },
  {
    name: 'create_schedule_blocks',
    description: 'Create schedule blocks for a job plan. Each block assigns a time slot on a specific work center.',
    input_schema: {
      type: 'object' as const,
      properties: {
        planId: { type: 'string', description: 'UUID of the JobPlan' },
        blocks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              workCenterId: { type: 'string' },
              startAt:      { type: 'string', description: 'ISO datetime start' },
              endAt:        { type: 'string', description: 'ISO datetime end' },
              notes:        { type: 'string' },
            },
            required: ['workCenterId', 'startAt', 'endAt'],
          },
        },
      },
      required: ['planId', 'blocks'],
    },
  },
];

async function execScheduleTool(name: string, input: any, companyId: string) {
  if (name === 'get_schedulable_jobs') {
    const plans = await (prisma as any).jobPlan.findMany({
      where: { companyId, workOrderId: { in: input.workOrderIds } },
      include: {
        workOrder: { select: { workOrderNumber: true, priority: true, scheduledDate: true, status: true } },
        equipment: { include: { workCenter: { select: { id: true, name: true, code: true, type: true } } }, orderBy: { sequenceOrder: 'asc' } },
        tasks: { where: { isComplete: false }, select: { title: true } },
      },
    });
    return plans;
  }

  if (name === 'get_work_center_availability') {
    const existing = await (prisma as any).scheduleBlock.findMany({
      where: {
        companyId,
        workCenterId: input.workCenterId,
        startAt: { gte: new Date(input.fromDate) },
        endAt:   { lte: new Date(input.toDate) },
      },
      orderBy: { startAt: 'asc' },
      select: { startAt: true, endAt: true, jobPlanId: true },
    });
    return {
      workCenterId: input.workCenterId,
      window: { from: input.fromDate, to: input.toDate },
      bookedSlots: existing,
    };
  }

  if (name === 'create_schedule_blocks') {
    const plan = await (prisma as any).jobPlan.findFirst({ where: { id: input.planId, companyId } });
    if (!plan) throw new Error('Plan not found');

    // Delete existing AI-generated blocks for this plan first
    await (prisma as any).scheduleBlock.deleteMany({ where: { jobPlanId: input.planId, aiGenerated: true } });

    const created = await Promise.all(
      input.blocks.map((b: any) =>
        (prisma as any).scheduleBlock.create({
          data: {
            companyId,
            jobPlanId: input.planId,
            workCenterId: b.workCenterId,
            startAt: new Date(b.startAt),
            endAt:   new Date(b.endAt),
            notes:   b.notes ?? null,
            aiGenerated: true,
            updatedAt: new Date(),
          },
        })
      )
    );

    // Update plan status to SCHEDULED
    await (prisma as any).jobPlan.update({
      where: { id: input.planId },
      data: { status: 'SCHEDULED', updatedAt: new Date() },
    });

    return { created: created.length, planStatus: 'SCHEDULED' };
  }

  throw new Error(`Unknown scheduling tool: ${name}`);
}

// ── Schedule endpoint (added to existing aiRoutes plugin above) ────────────────
// This is exported separately and registered inside aiRoutes below via closure
export async function registerScheduleRoute(fastify: any) {
  fastify.post('/schedule', {
    schema: { tags: ['AI'] },
    preHandler: [authenticate],
  }, async (request: any, reply: any) => {
    const { companyId } = request.user as { companyId: string };
    const body = z.object({
      workOrderIds: z.array(z.string().uuid()).min(1),
    }).parse(request.body);

    if (!process.env.ANTHROPIC_API_KEY) {
      return reply.status(503).send({ error: 'AI not configured' });
    }

    reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });

    const anthro = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const today = new Date();
    const twoWeeks = new Date(today.getTime() + 14 * 86400000);

    const scheduleSystemPrompt = `You are an operations scheduling AI for DiCandilo Metal Service Center.
Your job is to create an optimal schedule for the given work orders by:
1. Fetching the job plans to understand equipment requirements and durations
2. Checking work center availability to find free time slots
3. Creating schedule blocks that avoid conflicts and respect sequence order
4. Working hours are 07:00–17:00 Monday–Friday (AEST, UTC+10)
5. Schedule starting from today (${today.toISOString().slice(0, 10)})
6. Higher priority work orders (lower number) should be scheduled first
7. Group operations on the same work center where possible
Return a brief summary of what was scheduled.`;

    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: `Schedule these work orders: ${body.workOrderIds.join(', ')}. Today is ${today.toISOString()}. Window: ${today.toISOString()} to ${twoWeeks.toISOString()}.` },
    ];

    try {
      let iterations = 0;
      while (iterations++ < 8) {
        const response = await anthro.messages.create({
          model: 'claude-opus-4-6',
          max_tokens: 4096,
          system: scheduleSystemPrompt,
          tools: SCHEDULE_TOOLS,
          messages,
        });

        const assistantContent: Anthropic.ContentBlock[] = [];
        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const block of response.content) {
          assistantContent.push(block);
          if (block.type === 'tool_use') {
            const inp = block.input as any;
            sse(reply, { type: 'tool', tool: block.name, message: toolCallMessage(block.name, inp) });
            let result: any;
            try {
              result = await execScheduleTool(block.name, inp, companyId);
              sse(reply, { type: 'tool_result', tool: block.name, message: `Done` });
            } catch (toolErr) {
              result = { error: toolErr instanceof Error ? toolErr.message : 'Tool error' };
            }
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
          }
        }

        messages.push({ role: 'assistant', content: assistantContent });

        if (response.stop_reason === 'end_turn') {
          const textBlock = response.content.find((b) => b.type === 'text') as Anthropic.TextBlock | undefined;
          sse(reply, { type: 'done', message: textBlock?.text ?? 'Scheduling complete.' });
          break;
        }

        if (toolResults.length > 0) {
          messages.push({ role: 'user', content: toolResults });
        }
      }
    } catch (err) {
      sse(reply, { type: 'error', message: err instanceof Error ? err.message : 'Scheduling failed' });
    }

    reply.raw.end();
  });
}
