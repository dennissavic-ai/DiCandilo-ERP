import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AuthService } from './auth.service';
import { authenticate } from '../../middleware/auth.middleware';
import { handleError } from '../../utils/errors';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  companyName: z.string().min(1),
});

const refreshSchema = z.object({
  refreshToken: z.string().uuid(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(8),
  newPassword: z.string().min(8),
});

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  const service = new AuthService(fastify);

  fastify.post('/register', {
    schema: {
      tags: ['Auth'],
      body: {
        type: 'object',
        required: ['email', 'password', 'firstName', 'lastName', 'companyName'],
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 8 },
          firstName: { type: 'string' },
          lastName: { type: 'string' },
          companyName: { type: 'string' },
        },
      },
    },
    config: { auth: false },
  }, async (request, reply) => {
    try {
      const body = registerSchema.parse(request.body);
      const tokens = await service.register(body);
      return reply.status(201).send(tokens);
    } catch (err) {
      return handleError(reply, err);
    }
  });

  fastify.post('/login', {
    schema: {
      tags: ['Auth'],
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string' },
          password: { type: 'string' },
        },
      },
    },
    config: { auth: false },
  }, async (request, reply) => {
    try {
      const body = loginSchema.parse(request.body);
      const tokens = await service.login(body, request.ip);
      return reply.send(tokens);
    } catch (err) {
      return handleError(reply, err);
    }
  });

  fastify.post('/refresh', {
    schema: { tags: ['Auth'] },
    config: { auth: false },
  }, async (request, reply) => {
    try {
      const body = refreshSchema.parse(request.body);
      const tokens = await service.refreshToken(body.refreshToken);
      return reply.send(tokens);
    } catch (err) {
      return handleError(reply, err);
    }
  });

  fastify.post('/logout', {
    schema: { tags: ['Auth'] },
    preHandler: [authenticate],
  }, async (request, reply) => {
    try {
      const { refreshToken } = refreshSchema.parse(request.body);
      await service.logout(refreshToken);
      return reply.status(204).send();
    } catch (err) {
      return handleError(reply, err);
    }
  });

  fastify.put('/change-password', {
    schema: { tags: ['Auth'] },
    preHandler: [authenticate],
  }, async (request, reply) => {
    try {
      const body = changePasswordSchema.parse(request.body);
      await service.changePassword(
        (request.user as { sub: string }).sub,
        body.currentPassword,
        body.newPassword
      );
      return reply.status(204).send();
    } catch (err) {
      return handleError(reply, err);
    }
  });

  fastify.get('/me', {
    schema: { tags: ['Auth'] },
    preHandler: [authenticate],
  }, async (request, reply) => {
    const payload = request.user as {
      sub: string; email: string; companyId: string;
      branchId?: string; roleId: string; roleName: string;
    };

    const user = await fastify.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        avatarUrl: true,
        companyId: true,
        branchId: true,
        lastLoginAt: true,
        role: {
          select: {
            id: true,
            name: true,
            permissions: {
              select: {
                permission: { select: { module: true, action: true } },
              },
            },
          },
        },
      },
    });

    return reply.send(user);
  });
};

// Extend Fastify instance type to expose prisma
declare module 'fastify' {
  interface FastifyInstance {
    prisma: import('@prisma/client').PrismaClient;
  }
}
