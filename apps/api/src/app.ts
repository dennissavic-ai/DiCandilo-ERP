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

const app = Fastify({
  logger: {
    level: env.LOG_LEVEL,
    ...(env.NODE_ENV === 'development'
      ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
      : {}),
  },
});

async function buildApp() {
  // Security
  await app.register(helmet, { global: true });

  // CORS
  await app.register(cors, {
    origin: env.FRONTEND_URL,
    credentials: true,
  });

  // Rate limiting
  await app.register(rateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW,
  });

  // JWT
  await app.register(jwt, {
    secret: env.JWT_SECRET,
    sign: { expiresIn: env.JWT_ACCESS_EXPIRES },
  });

  // Multipart (CSV / file uploads — max 10 MB)
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });

  // WebSocket
  await app.register(websocket);

  // Swagger docs
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

  // Health check
  app.get('/health', { logLevel: 'silent' }, async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  }));

  // Register route modules
  const prefix = env.API_PREFIX;
  await app.register(authRoutes, { prefix: `${prefix}/auth` });
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
  await app.register(websocketPlugin, { prefix: `${prefix}/ws` });

  // Graceful shutdown
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

async function main() {
  try {
    const server = await buildApp();
    await prisma.$connect();
    startAutomationScheduler(server);
    await server.listen({ port: env.PORT, host: env.HOST });
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

main();

export { buildApp };
