import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../config/database';
import { authenticate, requirePermission } from '../../middleware/auth.middleware';

// ── Provider schemas ───────────────────────────────────────────────────────────

const xeroConfigSchema = z.object({
  accessToken:  z.string().min(1),
  tenantId:     z.string().min(1),
  clientId:     z.string().optional(),
  clientSecret: z.string().optional(),
});

const shopifyConfigSchema = z.object({
  shopDomain:   z.string().min(1), // e.g. "myshop.myshopify.com"
  accessToken:  z.string().min(1),
});

type XeroConfig     = z.infer<typeof xeroConfigSchema>;
type ShopifyConfig  = z.infer<typeof shopifyConfigSchema>;

// ── Xero sync ─────────────────────────────────────────────────────────────────

interface XeroContact {
  ContactID:    string;
  Name:         string;
  FirstName?:   string;
  LastName?:    string;
  EmailAddress?: string;
  TaxNumber?:   string;
  Phones?:      { PhoneType: string; PhoneNumber: string }[];
  Addresses?:   {
    AddressType: string;
    AddressLine1?: string;
    City?: string;
    Region?: string;
    PostalCode?: string;
    Country?: string;
  }[];
  IsCustomer:   boolean;
  IsSupplier:   boolean;
}

async function syncXeroCustomers(
  companyId: string,
  credentialId: string,
  config: XeroConfig,
  triggeredBy: string,
): Promise<string> {
  const log = await (prisma as any).syncLog.create({
    data: {
      companyId,
      credentialId,
      provider: 'xero',
      direction: 'IMPORT',
      entityType: 'customer',
      status: 'RUNNING',
      triggeredBy,
    },
  });

  let totalRecords = 0;
  let syncedRecords = 0;
  const errors: { id: string; name: string; error: string }[] = [];
  let page = 1;

  try {
    while (true) {
      const res = await fetch(
        `https://api.xero.com/api.xro/2.0/Contacts?IsCustomer=true&page=${page}&pageSize=100`,
        {
          headers: {
            Authorization: `Bearer ${config.accessToken}`,
            'Xero-Tenant-Id': config.tenantId,
            Accept: 'application/json',
          },
        }
      );

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Xero API error ${res.status}: ${text}`);
      }

      const json = (await res.json()) as { Contacts: XeroContact[] };
      const contacts = json.Contacts ?? [];
      if (contacts.length === 0) break;

      totalRecords += contacts.length;

      for (const contact of contacts) {
        try {
          const billingAddr = contact.Addresses?.find((a) => a.AddressType === 'POBOX') ??
                              contact.Addresses?.[0];
          const primaryEmail = contact.EmailAddress;
          const primaryPhone = contact.Phones?.find((p) => p.PhoneType === 'DEFAULT')?.PhoneNumber
                            ?? contact.Phones?.[0]?.PhoneNumber;

          const contactsJson = [
            ...(primaryEmail ? [{ type: 'email', value: primaryEmail }] : []),
            ...(primaryPhone ? [{ type: 'phone', value: primaryPhone }] : []),
          ];

          const existing = await prisma.customer.findFirst({
            where: {
              companyId,
              xeroContactId: contact.ContactID,
              deletedAt: null,
            },
          });

          if (existing) {
            await prisma.customer.update({
              where: { id: existing.id },
              data: {
                name: contact.Name,
                taxId: contact.TaxNumber ?? existing.taxId,
                contacts: contactsJson.length ? contactsJson : undefined,
                billingAddress: billingAddr
                  ? {
                      line1:      billingAddr.AddressLine1 ?? '',
                      city:       billingAddr.City ?? '',
                      state:      billingAddr.Region ?? '',
                      postcode:   billingAddr.PostalCode ?? '',
                      country:    billingAddr.Country ?? '',
                    }
                  : undefined,
                updatedBy: triggeredBy,
              },
            });
          } else {
            // generate a safe unique code
            const code = `XERO-${contact.ContactID.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
            const codeExists = await prisma.customer.findFirst({
              where: { companyId, code, deletedAt: null },
            });

            await prisma.customer.create({
              data: {
                companyId,
                code: codeExists ? `XERO-${contact.ContactID.replace(/-/g, '').slice(0, 12).toUpperCase()}` : code,
                name: contact.Name,
                taxId: contact.TaxNumber,
                xeroContactId: contact.ContactID,
                contacts: contactsJson,
                billingAddress: billingAddr
                  ? {
                      line1:    billingAddr.AddressLine1 ?? '',
                      city:     billingAddr.City ?? '',
                      state:    billingAddr.Region ?? '',
                      postcode: billingAddr.PostalCode ?? '',
                      country:  billingAddr.Country ?? '',
                    }
                  : undefined,
                createdBy: triggeredBy,
              },
            });
          }
          syncedRecords++;
        } catch (err) {
          errors.push({
            id:    contact.ContactID,
            name:  contact.Name,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      if (contacts.length < 100) break;
      page++;
    }

    const status = errors.length === 0 ? 'SUCCESS' : errors.length < totalRecords ? 'PARTIAL' : 'FAILED';

    await (prisma as any).syncLog.update({
      where: { id: log.id },
      data: { status, totalRecords, syncedRecords, errorCount: errors.length, errors, completedAt: new Date() },
    });

    await (prisma as any).integrationCredential.update({
      where: { id: credentialId },
      data: { lastSyncAt: new Date() },
    });
  } catch (err) {
    await (prisma as any).syncLog.update({
      where: { id: log.id },
      data: {
        status: 'FAILED',
        totalRecords,
        syncedRecords,
        errorCount: 1,
        errors: [{ error: err instanceof Error ? err.message : String(err) }],
        completedAt: new Date(),
      },
    });
  }

  return log.id;
}

// ── Shopify sync ──────────────────────────────────────────────────────────────

interface ShopifyCustomer {
  id: number;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  default_address?: {
    address1?: string;
    city?: string;
    province?: string;
    zip?: string;
    country?: string;
    company?: string;
  };
  tax_exempt: boolean;
  state: string; // 'enabled' | 'disabled' | 'invited' | 'declined'
}

async function syncShopifyCustomers(
  companyId: string,
  credentialId: string,
  config: ShopifyConfig,
  triggeredBy: string,
): Promise<string> {
  const log = await (prisma as any).syncLog.create({
    data: {
      companyId,
      credentialId,
      provider: 'shopify',
      direction: 'IMPORT',
      entityType: 'customer',
      status: 'RUNNING',
      triggeredBy,
    },
  });

  let totalRecords = 0;
  let syncedRecords = 0;
  const errors: { id: string; name: string; error: string }[] = [];
  let nextPageUrl: string | null =
    `https://${config.shopDomain}/admin/api/2024-01/customers.json?limit=250`;

  try {
    while (nextPageUrl) {
      const res = await fetch(nextPageUrl, {
        headers: {
          'X-Shopify-Access-Token': config.accessToken,
          'Content-Type': 'application/json',
        },
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Shopify API error ${res.status}: ${text}`);
      }

      const json = (await res.json()) as { customers: ShopifyCustomer[] };
      const customers = json.customers ?? [];
      totalRecords += customers.length;

      for (const cust of customers) {
        try {
          const shopifyId = String(cust.id);
          const fullName = [cust.first_name, cust.last_name].filter(Boolean).join(' ') || `Shopify Customer ${shopifyId}`;

          const contactsJson: { type: string; value: string }[] = [];
          if (cust.email) contactsJson.push({ type: 'email', value: cust.email });
          if (cust.phone) contactsJson.push({ type: 'phone', value: cust.phone });

          const addr = cust.default_address;

          const existing = await prisma.customer.findFirst({
            where: { companyId, shopifyCustomerId: shopifyId, deletedAt: null },
          });

          if (existing) {
            await prisma.customer.update({
              where: { id: existing.id },
              data: {
                name: fullName,
                legalName: addr?.company ?? existing.legalName,
                contacts: contactsJson.length ? contactsJson : undefined,
                taxExempt: cust.tax_exempt,
                billingAddress: addr
                  ? {
                      line1:    addr.address1 ?? '',
                      city:     addr.city ?? '',
                      state:    addr.province ?? '',
                      postcode: addr.zip ?? '',
                      country:  addr.country ?? '',
                    }
                  : undefined,
                isActive: cust.state === 'enabled',
                updatedBy: triggeredBy,
              },
            });
          } else {
            const code = `SHOP-${shopifyId.slice(-8).padStart(8, '0')}`;
            const codeExists = await prisma.customer.findFirst({
              where: { companyId, code, deletedAt: null },
            });

            await prisma.customer.create({
              data: {
                companyId,
                code: codeExists ? `SHOP-${shopifyId}` : code,
                name: fullName,
                legalName: addr?.company,
                shopifyCustomerId: shopifyId,
                contacts: contactsJson,
                taxExempt: cust.tax_exempt,
                isActive: cust.state === 'enabled',
                billingAddress: addr
                  ? {
                      line1:    addr.address1 ?? '',
                      city:     addr.city ?? '',
                      state:    addr.province ?? '',
                      postcode: addr.zip ?? '',
                      country:  addr.country ?? '',
                    }
                  : undefined,
                createdBy: triggeredBy,
              },
            });
          }
          syncedRecords++;
        } catch (err) {
          errors.push({
            id:    String(cust.id),
            name:  [cust.first_name, cust.last_name].filter(Boolean).join(' ') || String(cust.id),
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // Shopify pagination via Link header
      const linkHeader = res.headers.get('link') ?? '';
      const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
      nextPageUrl = nextMatch ? nextMatch[1] : null;
    }

    const status = errors.length === 0 ? 'SUCCESS' : errors.length < totalRecords ? 'PARTIAL' : 'FAILED';

    await (prisma as any).syncLog.update({
      where: { id: log.id },
      data: { status, totalRecords, syncedRecords, errorCount: errors.length, errors, completedAt: new Date() },
    });

    await (prisma as any).integrationCredential.update({
      where: { id: credentialId },
      data: { lastSyncAt: new Date() },
    });
  } catch (err) {
    await (prisma as any).syncLog.update({
      where: { id: log.id },
      data: {
        status: 'FAILED',
        totalRecords,
        syncedRecords,
        errorCount: 1,
        errors: [{ error: err instanceof Error ? err.message : String(err) }],
        completedAt: new Date(),
      },
    });
  }

  return log.id;
}

// ── Routes ────────────────────────────────────────────────────────────────────

export const integrationRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /integrations/config — list all provider configs (tokens redacted)
  fastify.get('/config', { preHandler: [authenticate] }, async (request, reply) => {
    const { companyId } = request.user as { companyId: string };

    const creds = await (prisma as any).integrationCredential.findMany({
      where: { companyId },
      select: {
        id: true,
        provider: true,
        isActive: true,
        lastSyncAt: true,
        createdAt: true,
        updatedAt: true,
        // config intentionally excluded — use GET /config/:provider to see redacted view
      },
    });

    return reply.send({ data: creds });
  });

  // GET /integrations/config/:provider — get config with redacted secrets
  fastify.get('/config/:provider', { preHandler: [authenticate] }, async (request, reply) => {
    const { companyId } = request.user as { companyId: string };
    const { provider } = request.params as { provider: string };

    const cred = await (prisma as any).integrationCredential.findUnique({
      where: { companyId_provider: { companyId, provider } },
    });

    if (!cred) return reply.send({ data: null });

    // Return config with tokens redacted
    const cfg = cred.config as Record<string, unknown>;
    const redacted: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(cfg)) {
      if (typeof v === 'string' && (k.toLowerCase().includes('token') || k.toLowerCase().includes('secret'))) {
        redacted[k] = v.length > 8 ? `${v.slice(0, 4)}${'•'.repeat(v.length - 8)}${v.slice(-4)}` : '••••';
      } else {
        redacted[k] = v;
      }
    }

    return reply.send({ data: { ...cred, config: redacted } });
  });

  // PUT /integrations/config/:provider — save/update credentials
  fastify.put('/config/:provider', { preHandler: [authenticate, requirePermission('admin', 'edit')] }, async (request, reply) => {
    const { companyId, sub } = request.user as { companyId: string; sub: string };
    const { provider } = request.params as { provider: string };
    const body = request.body as Record<string, unknown>;

    if (!['xero', 'shopify'].includes(provider)) {
      return reply.status(400).send({ error: 'INVALID_PROVIDER', message: 'Provider must be xero or shopify' });
    }

    let config: Record<string, unknown>;
    if (provider === 'xero') {
      const parsed = xeroConfigSchema.safeParse(body);
      if (!parsed.success) return reply.status(400).send({ error: 'VALIDATION_ERROR', issues: parsed.error.issues });
      config = parsed.data;
    } else {
      const parsed = shopifyConfigSchema.safeParse(body);
      if (!parsed.success) return reply.status(400).send({ error: 'VALIDATION_ERROR', issues: parsed.error.issues });
      config = parsed.data;
    }

    const existing = await (prisma as any).integrationCredential.findUnique({
      where: { companyId_provider: { companyId, provider } },
    });

    if (existing) {
      // Merge: allow partial updates (e.g. don't wipe token if not re-submitted)
      const mergedConfig = { ...(existing.config as object), ...config };
      const updated = await (prisma as any).integrationCredential.update({
        where: { id: existing.id },
        data: { config: mergedConfig, isActive: true, updatedBy: sub },
      });
      return reply.send({ data: updated });
    } else {
      const created = await (prisma as any).integrationCredential.create({
        data: { companyId, provider, config, isActive: true, updatedBy: sub },
      });
      return reply.send({ data: created });
    }
  });

  // DELETE /integrations/config/:provider — disconnect integration
  fastify.delete('/config/:provider', { preHandler: [authenticate, requirePermission('admin', 'delete')] }, async (request, reply) => {
    const { companyId } = request.user as { companyId: string };
    const { provider } = request.params as { provider: string };

    const existing = await (prisma as any).integrationCredential.findUnique({
      where: { companyId_provider: { companyId, provider } },
    });

    if (!existing) return reply.status(404).send({ error: 'NOT_FOUND' });

    await (prisma as any).integrationCredential.update({
      where: { id: existing.id },
      data: { isActive: false, config: {} },
    });

    return reply.send({ message: 'Integration disconnected' });
  });

  // POST /integrations/sync/:provider — trigger sync (runs async, returns logId)
  fastify.post('/sync/:provider', { preHandler: [authenticate, requirePermission('admin', 'edit')] }, async (request, reply) => {
    const { companyId, sub } = request.user as { companyId: string; sub: string };
    const { provider } = request.params as { provider: string };

    if (!['xero', 'shopify'].includes(provider)) {
      return reply.status(400).send({ error: 'INVALID_PROVIDER' });
    }

    const cred = await (prisma as any).integrationCredential.findUnique({
      where: { companyId_provider: { companyId, provider } },
    });

    if (!cred || !cred.isActive) {
      return reply.status(404).send({ error: 'NOT_CONNECTED', message: `${provider} integration is not configured` });
    }

    // Fire-and-forget async sync; return logId immediately
    let logIdPromise: Promise<string>;
    if (provider === 'xero') {
      logIdPromise = syncXeroCustomers(companyId, cred.id, cred.config as XeroConfig, sub);
    } else {
      logIdPromise = syncShopifyCustomers(companyId, cred.id, cred.config as ShopifyConfig, sub);
    }

    // Return the log ID once the log record is created (it's already created at top of sync fn)
    const logId = await logIdPromise;
    return reply.send({ message: 'Sync complete', logId });
  });

  // GET /integrations/sync/logs — paginated sync history
  fastify.get('/sync/logs', { preHandler: [authenticate] }, async (request, reply) => {
    const { companyId } = request.user as { companyId: string };
    const query = request.query as { page?: string; limit?: string; provider?: string };

    const page  = Math.max(1, Number(query.page  ?? 1));
    const limit = Math.min(50, Math.max(1, Number(query.limit ?? 20)));
    const skip  = (page - 1) * limit;

    const where: Record<string, unknown> = { companyId };
    if (query.provider) where.provider = query.provider;

    const [total, logs] = await Promise.all([
      (prisma as any).syncLog.count({ where }),
      (prisma as any).syncLog.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true, provider: true, direction: true, entityType: true,
          status: true, totalRecords: true, syncedRecords: true, errorCount: true,
          startedAt: true, completedAt: true, triggeredBy: true,
          // errors excluded from list view for brevity
        },
      }),
    ]);

    return reply.send({
      data: logs,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  });

  // GET /integrations/sync/logs/:id — single log with errors
  fastify.get('/sync/logs/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const { companyId } = request.user as { companyId: string };
    const { id } = request.params as { id: string };

    const log = await (prisma as any).syncLog.findFirst({
      where: { id, companyId },
    });

    if (!log) return reply.status(404).send({ error: 'NOT_FOUND' });
    return reply.send({ data: log });
  });
};
