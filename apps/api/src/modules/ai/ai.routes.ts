import { FastifyPluginAsync } from 'fastify';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { prisma } from '../../config/database';
import { authenticate } from '../../middleware/auth.middleware';
import { handleError } from '../../utils/errors';

const SYSTEM_PROMPT = `You are a sales assistant for DiCandilo Metal Service Center ERP.
Your job is to create quotes quickly from natural-language order descriptions.

Workflow:
1. Use search_customers to find the right customer. Pick the best match.
2. For each product mentioned, use search_products to find it by code, description, or material spec. Pick the closest match.
3. Once you have the customer and all products, call create_quote.

Rules:
- Always search before assuming — never invent customer IDs or product IDs.
- Unit prices come from the product's listPrice. Never make up a price.
- If quantity isn't specified, default to 1.
- If UOM isn't specified, use the product's UOM.
- If you cannot find a product, describe it as a manual line (no productId, you provide description + unitPrice: 0).
- Be concise in your reasoning. Act decisively.`;

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'search_customers',
    description: 'Search for customers by name, code, or partial match. Returns up to 5 results.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Customer name, code, or keywords to search for' },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_products',
    description: 'Search the product library by code, description, material type, grade, or dimensions. Returns up to 8 results with list prices.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Product code, description, material spec, or keywords' },
      },
      required: ['query'],
    },
  },
  {
    name: 'create_quote',
    description: 'Create a draft quote for the customer with the given line items.',
    input_schema: {
      type: 'object' as const,
      properties: {
        customerId: { type: 'string', description: 'UUID of the customer' },
        currency: { type: 'string', description: 'Currency code, e.g. AUD', default: 'AUD' },
        notes: { type: 'string', description: 'Optional customer-facing notes' },
        lines: {
          type: 'array',
          description: 'Line items for the quote',
          items: {
            type: 'object',
            properties: {
              productId:   { type: 'string',  description: 'UUID of the product (omit for manual lines)' },
              description: { type: 'string',  description: 'Line description (required)' },
              qty:         { type: 'integer', description: 'Quantity ordered', default: 1 },
              uom:         { type: 'string',  description: 'Unit of measure, e.g. EA, KG, SHT', default: 'EA' },
              unitPrice:   { type: 'integer', description: 'Unit price in cents (from listPrice)', default: 0 },
              discountPct: { type: 'number',  description: 'Discount percentage 0-100', default: 0 },
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
  const results = await prisma.customer.findMany({
    where: {
      companyId,
      deletedAt: null,
      isActive: true,
      OR: [
        { name: { contains: query, mode: 'insensitive' } },
        { code: { contains: query, mode: 'insensitive' } },
      ],
    },
    take: 5,
    select: { id: true, code: true, name: true, creditTerms: true, currencyCode: true },
  });
  return results;
}

async function searchProducts(companyId: string, query: string) {
  const results = await prisma.product.findMany({
    where: {
      companyId,
      deletedAt: null,
      isActive: true,
      OR: [
        { code:         { contains: query, mode: 'insensitive' } },
        { description:  { contains: query, mode: 'insensitive' } },
        { grade:        { contains: query, mode: 'insensitive' } },
        { materialType: { contains: query, mode: 'insensitive' } },
        { longDescription: { contains: query, mode: 'insensitive' } },
      ],
    },
    take: 8,
    select: { id: true, code: true, description: true, uom: true, listPrice: true, materialType: true, grade: true, shape: true },
  });
  return results.map((p) => ({ ...p, listPrice: Number(p.listPrice) }));
}

async function createQuote(
  companyId: string,
  branchId: string,
  userId: string,
  input: {
    customerId: string;
    currency?: string;
    notes?: string;
    lines: { productId?: string; description: string; qty: number; uom: string; unitPrice: number; discountPct?: number }[];
  },
) {
  const count  = await prisma.salesQuote.count({ where: { companyId } });
  const quoteNumber = `Q-${String(count + 1).padStart(6, '0')}`;

  const subtotal = input.lines.reduce((sum, l) => {
    const ls = l.qty * l.unitPrice;
    return sum + ls - Math.round(ls * (l.discountPct ?? 0) / 100);
  }, 0);

  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + 30);

  const quote = await prisma.salesQuote.create({
    data: {
      companyId,
      branchId: branchId ?? '',
      customerId: input.customerId,
      quoteNumber,
      status: 'DRAFT',
      quoteDate: new Date(),
      validUntil,
      currencyCode: input.currency ?? 'AUD',
      subtotal,
      taxAmount: Math.round(subtotal * 0.1),
      totalAmount: subtotal + Math.round(subtotal * 0.1),
      notes: input.notes,
      createdBy: userId,
      updatedBy: userId,
      lines: {
        create: input.lines.map((l, i) => {
          const ls = l.qty * l.unitPrice;
          return {
            lineNumber:  i + 1,
            productId:   l.productId,
            description: l.description,
            uom:         l.uom,
            qty:         l.qty,
            unitPrice:   l.unitPrice,
            discountPct: l.discountPct ?? 0,
            lineTotal:   ls - Math.round(ls * (l.discountPct ?? 0) / 100),
          };
        }),
      },
    },
  });

  return { quoteId: quote.id, quoteNumber: quote.quoteNumber };
}

// ── SSE helper ────────────────────────────────────────────────────────────────

function sseEvent(reply: { raw: { write: (s: string) => void } }, event: object) {
  reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
}

// ── Routes ────────────────────────────────────────────────────────────────────

export const aiRoutes: FastifyPluginAsync = async (fastify) => {

  fastify.post('/quote-assistant', {
    schema: { tags: ['AI'] },
    preHandler: [authenticate],
  }, async (request, reply) => {
    const { companyId, branchId, sub } = request.user as { companyId: string; branchId: string; sub: string };

    const body = z.object({ prompt: z.string().min(5).max(2000) }).parse(request.body);

    if (!process.env.ANTHROPIC_API_KEY) {
      return reply.status(503).send({ error: 'AI assistant not configured. Set ANTHROPIC_API_KEY.' });
    }

    // Set SSE headers
    reply.raw.writeHead(200, {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection:      'keep-alive',
    });

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: body.prompt },
    ];

    try {
      sseEvent(reply, { type: 'status', message: 'Analysing your request…' });

      let iterations = 0;
      const MAX_ITER = 10;

      while (iterations++ < MAX_ITER) {
        const response = await client.messages.create({
          model: 'claude-opus-4-6',
          max_tokens: 4096,
          thinking: { type: 'adaptive' },
          system: SYSTEM_PROMPT,
          tools: TOOLS,
          messages,
        });

        // Emit any text Claude produces
        for (const block of response.content) {
          if (block.type === 'text' && block.text.trim()) {
            sseEvent(reply, { type: 'thinking', message: block.text });
          }
        }

        if (response.stop_reason === 'end_turn') break;

        const toolUses = response.content.filter(
          (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
        );
        if (toolUses.length === 0) break;

        messages.push({ role: 'assistant', content: response.content });

        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const tool of toolUses) {
          let result: unknown;

          if (tool.name === 'search_customers') {
            const { query } = tool.input as { query: string };
            sseEvent(reply, { type: 'tool', tool: 'search_customers', message: `Searching customers: "${query}"` });
            const customers = await searchCustomers(companyId, query);
            sseEvent(reply, { type: 'tool_result', tool: 'search_customers', message: `Found ${customers.length} customer(s)`, data: customers });
            result = customers;
          } else if (tool.name === 'search_products') {
            const { query } = tool.input as { query: string };
            sseEvent(reply, { type: 'tool', tool: 'search_products', message: `Searching products: "${query}"` });
            const products = await searchProducts(companyId, query);
            sseEvent(reply, { type: 'tool_result', tool: 'search_products', message: `Found ${products.length} product(s)`, data: products });
            result = products;
          } else if (tool.name === 'create_quote') {
            const input = tool.input as Parameters<typeof createQuote>[3];
            sseEvent(reply, { type: 'tool', tool: 'create_quote', message: `Creating quote with ${input.lines.length} line(s)…` });
            const quote = await createQuote(companyId, branchId, sub, input);
            sseEvent(reply, { type: 'done', quoteId: quote.quoteId, quoteNumber: quote.quoteNumber, message: `Quote ${quote.quoteNumber} created` });
            result = quote;
          } else {
            result = { error: `Unknown tool: ${tool.name}` };
          }

          toolResults.push({ type: 'tool_result', tool_use_id: tool.id, content: JSON.stringify(result) });
        }

        messages.push({ role: 'user', content: toolResults });
      }
    } catch (err) {
      sseEvent(reply, { type: 'error', message: err instanceof Error ? err.message : 'Unknown error' });
      fastify.log.error(err, 'AI quote assistant error');
    }

    reply.raw.end();
  });
};
