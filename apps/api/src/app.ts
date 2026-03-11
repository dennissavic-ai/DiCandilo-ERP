import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import websocket from '@fastify/websocket';

import { env } from './config/env';
import { prisma } from './config/database';

// Route modules
import { authRoutes } from './modules/auth/auth.routes';
import { inventoryRoutes } from './modules/inventory/inventory.routes';
import { purchasingRoutes } from './modules/purchasing/purchasing.routes';
import { salesRoutes } from './modules/sales/sales.routes';
import { processingRoutes } from './modules/processing/processing.routes';
import { accountingRoutes } from './modules/accounting/accounting.routes';
import { reportingRoutes } from './modules/reporting/reporting.routes';
import { userRoutes } from './modules/users/user.routes';
import { taskRoutes } from './modules/tasks/task.routes';
import { barcodeRoutes } from './modules/barcoding/barcode.routes';
import { shippingRoutes } from './modules/shipping/shipping.routes';
import { nestingRoutes } from './modules/nesting/nesting.routes';
import { websocketPlugin } from './websocket/ws.plugin';
import { automationRoutes } from './modules/automation/automation.routes';
import { startAutomationScheduler } from './modules/automation/automation.scheduler';
import { complianceRoutes } from './modules/compliance/compliance.routes';
import { fulfillmentRoutes } from './modules/fulfillment/fulfillment.routes';
import { startFulfillmentScheduler } from './modules/fulfillment/fulfillment.scheduler';
import { crmRoutes } from './modules/crm/crm.routes';
import { integrationRoutes } from './modules/integrations/integrations.routes';
import { aiRoutes } from './modules/ai/ai.routes';
import planningRoutes from './modules/planning/planning.routes';

const app = Fastify({
  logger: {
    level: env.LOG_LEVEL,
    ...(env.NODE_ENV === 'development'
      ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
      : {}),
    // OWASP API8 / SOC2 CC7 — Never log request bodies (may contain passwords/PII)
    serializers: {
      req(req: any) {
        return { method: req.method, url: req.url, hostname: req.hostname };
      },
    },
  },
});

Object.defineProperty(BigInt.prototype, 'toJSON', {
  get() {
    return () => Number(this);
  },
});


async function buildApp() {
  // ── Security headers (OWASP API8 / SOC2 CC6) ──────────────────────────────
  await app.register(helmet, {
    global: true,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],  // swagger-ui needs inline styles
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
    crossOriginEmbedderPolicy: false, // swagger-ui compatibility
    hsts: {
      maxAge: 31536000,         // 1 year (ISO 27001 A.10.1 / NIST PR.DS-2)
      includeSubDomains: true,
      preload: true,
    },
  });

  // ── CORS ──────────────────────────────────────────────────────────────────
  await app.register(cors, {
    origin: env.FRONTEND_URL,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // ── Global rate limit (OWASP API4) ────────────────────────────────────────
  await app.register(rateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW,
    keyGenerator: (req) => req.ip,
    errorResponseBuilder: () => ({
      error: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests. Please slow down.',
    }),
  });

  // ── JWT ───────────────────────────────────────────────────────────────────
  await app.register(jwt, {
    secret: env.JWT_SECRET,
    sign: { expiresIn: env.JWT_ACCESS_EXPIRES },
  });

  // ── Multipart (CSV / file uploads — max 10 MB) ────────────────────────────
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });

  // ── WebSocket ─────────────────────────────────────────────────────────────
  await app.register(websocket);

  // ── Swagger docs (disabled in production unless explicitly enabled) ────────
  // OWASP API9 — API documentation should not be publicly exposed in production
  if (env.SWAGGER_ENABLED || env.NODE_ENV === 'development') {
    await app.register(swagger, {
      openapi: {
        openapi: '3.0.0',
        info: {
          title: 'DiCandilo ERP API',
          description: 'Metal Service Center ERP — REST API',
          version: '1.0.0',
        },
        servers: [{ url: env.API_PREFIX }],
        components: {
          securitySchemes: {
            bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
          },
        },
        security: [{ bearerAuth: [] }],
      },
    });

    await app.register(swaggerUi, {
      routePrefix: '/docs',
      uiConfig: { docExpansion: 'list', deepLinking: false },
    });
  }

  // ── Health check ──────────────────────────────────────────────────────────
  app.get('/health', { logLevel: 'silent' }, async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  }));

  // ── Route modules ─────────────────────────────────────────────────────────
  const prefix = env.API_PREFIX;

  // Auth routes get a stricter rate limit (OWASP API2 / SOC2 CC6 brute-force)
  await app.register(
    async (authContext) => {
      await authContext.register(rateLimit, {
        max: env.AUTH_RATE_LIMIT_MAX,
        timeWindow: env.AUTH_RATE_LIMIT_WINDOW,
        keyGenerator: (req) => req.ip,
        errorResponseBuilder: () => ({
          error: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many authentication attempts. Please try again later.',
        }),
      });
      await authContext.register(authRoutes);
    },
    { prefix: `${prefix}/auth` }
  );

  await app.register(inventoryRoutes, { prefix: `${prefix}/inventory` });
  await app.register(purchasingRoutes, { prefix: `${prefix}/purchasing` });
  await app.register(salesRoutes, { prefix: `${prefix}/sales` });
  await app.register(processingRoutes, { prefix: `${prefix}/processing` });
  await app.register(accountingRoutes, { prefix: `${prefix}/accounting` });
  await app.register(reportingRoutes, { prefix: `${prefix}/reporting` });
  await app.register(userRoutes, { prefix: `${prefix}/users` });
  await app.register(taskRoutes, { prefix: `${prefix}/tasks` });
  await app.register(barcodeRoutes, { prefix: `${prefix}/barcodes` });
  await app.register(shippingRoutes, { prefix: `${prefix}/shipping` });
  await app.register(nestingRoutes, { prefix: `${prefix}/nesting` });
  await app.register(automationRoutes, { prefix: `${prefix}/automation` });
  await app.register(complianceRoutes, { prefix: `${prefix}/compliance` });
  await app.register(fulfillmentRoutes, { prefix: `${prefix}/inventory/fulfillment` });
  await app.register(crmRoutes, { prefix: `${prefix}/crm` });
  await app.register(integrationRoutes, { prefix: `${prefix}/integrations` });
  await app.register(aiRoutes, { prefix: `${prefix}/ai` });
  await app.register(planningRoutes, { prefix: `${prefix}/planning` });
  await app.register(websocketPlugin, { prefix: `${prefix}/ws` });

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  signals.forEach((signal) => {
    process.on(signal, async () => {
      app.log.info(`Received ${signal}, shutting down...`);
      await app.close();
      await prisma.$disconnect();
      process.exit(0);
    });
  });

  return app;
}

// ── Token / session cleanup scheduler ─────────────────────────────────────────
// SOC2 CC6 / ISO 27001 A.9.4.2 — Remove expired sessions to limit attack surface
function startTokenCleanupScheduler(): void {
  const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6 hours

  setInterval(async () => {
    try {
      const deleted = await prisma.refreshToken.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });
      if (deleted.count > 0) {
        console.info(`[token-cleanup] Removed ${deleted.count} expired refresh token(s)`);
      }
    } catch (err) {
      console.error('[token-cleanup] Error during token cleanup:', err);
    }
  }, CLEANUP_INTERVAL_MS);
}

async function main() {
  try {
    const server = await buildApp();
    await prisma.$connect();
    startAutomationScheduler(server);
    startFulfillmentScheduler(server);
    startTokenCleanupScheduler();
    await server.listen({ port: env.PORT, host: env.HOST });
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

main();

export { buildApp };
