import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AuthService } from './auth.service';
import { authenticate } from '../../middleware/auth.middleware';
import { handleError } from '../../utils/errors';
import { passwordSchema } from '../../utils/password';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  totpCode: z.string().optional(),
});

// Registration & password changes enforce full complexity (SOC2 CC6 / NIST SP 800-63B)
const registerSchema = z.object({
  email: z.string().email(),
  password: passwordSchema,
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  companyName: z.string().min(1),
});

const refreshSchema = z.object({
  refreshToken: z.string().uuid(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});

// MFA schemas
const enableMfaSchema = z.object({
  secret: z.string().min(16),
  totpCode: z.string().length(6),
});

const disableMfaSchema = z.object({
  currentPassword: z.string().min(1),
});

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  const service = new AuthService(fastify);

  // ── Register ──────────────────────────────────────────────────────────────
  fastify.post('/register', {
    schema: {
      tags: ['Auth'],
      body: {
        type: 'object',
        required: ['email', 'password', 'firstName', 'lastName', 'companyName'],
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 12, description: 'Min 12 chars, upper, lower, digit, special' },
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

  // ── Login ─────────────────────────────────────────────────────────────────
  fastify.post('/login', {
    schema: {
      tags: ['Auth'],
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string' },
          password: { type: 'string' },
          totpCode: { type: 'string', description: 'TOTP code — required if MFA is enabled' },
        },
      },
    },
    config: { auth: false },
  }, async (request, reply) => {
    try {
      const body = loginSchema.parse(request.body);
      const tokens = await service.login(
        body,
        request.ip,
        request.headers['user-agent']
      );
      return reply.send(tokens);
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // ── Refresh token ──────────────────────────────────────────────────────────
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

  // ── Logout ────────────────────────────────────────────────────────────────
  fastify.post('/logout', {
    schema: { tags: ['Auth'] },
    preHandler: [authenticate],
  }, async (request, reply) => {
    try {
      const { refreshToken } = refreshSchema.parse(request.body);
      const { sub, companyId } = request.user as { sub: string; companyId: string };
      await service.logout(
        refreshToken,
        sub,
        companyId,
        request.ip,
        request.headers['user-agent']
      );
      return reply.status(204).send();
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // ── Change password ────────────────────────────────────────────────────────
  fastify.put('/change-password', {
    schema: { tags: ['Auth'] },
    preHandler: [authenticate],
  }, async (request, reply) => {
    try {
      const body = changePasswordSchema.parse(request.body);
      await service.changePassword(
        (request.user as { sub: string }).sub,
        body.currentPassword,
        body.newPassword,
        request.ip,
        request.headers['user-agent']
      );
      return reply.status(204).send();
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // ── Me ────────────────────────────────────────────────────────────────────
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
        mfaEnabled: true,
        requirePasswordChange: true,
        // Never expose: passwordHash, mfaSecret, loginAttempts, lockedUntil
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

  // ── MFA: generate setup secret ─────────────────────────────────────────────
  fastify.post('/mfa/setup', {
    schema: {
      tags: ['Auth'],
      description: 'Generate a TOTP secret + otpauth URL for QR display. Confirm with /mfa/enable.',
    },
    preHandler: [authenticate],
  }, async (request, reply) => {
    try {
      const { sub: userId, email } = request.user as { sub: string; email: string };
      const result = service.generateMfaSecret(email);
      // Return secret in plaintext — client uses it to display QR, then sends back to /mfa/enable
      return reply.send({ secret: result.secret, otpauthUrl: result.otpauthUrl });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // ── MFA: confirm + enable ──────────────────────────────────────────────────
  fastify.post('/mfa/enable', {
    schema: {
      tags: ['Auth'],
      description: 'Verify the first TOTP code against the setup secret, then persist and enable MFA.',
      body: {
        type: 'object',
        required: ['secret', 'totpCode'],
        properties: {
          secret: { type: 'string' },
          totpCode: { type: 'string', description: '6-digit TOTP code from authenticator app' },
        },
      },
    },
    preHandler: [authenticate],
  }, async (request, reply) => {
    try {
      const body = enableMfaSchema.parse(request.body);
      const { sub: userId } = request.user as { sub: string };
      await service.enableMfa(userId, body.secret, body.totpCode);
      return reply.send({ message: 'MFA enabled successfully' });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // ── MFA: disable ──────────────────────────────────────────────────────────
  fastify.post('/mfa/disable', {
    schema: {
      tags: ['Auth'],
      description: 'Disable MFA. Requires current password confirmation.',
      body: {
        type: 'object',
        required: ['currentPassword'],
        properties: { currentPassword: { type: 'string' } },
      },
    },
    preHandler: [authenticate],
  }, async (request, reply) => {
    try {
      const body = disableMfaSchema.parse(request.body);
      const { sub: userId } = request.user as { sub: string };
      await service.disableMfa(
        userId,
        body.currentPassword,
        request.ip,
        request.headers['user-agent']
      );
      return reply.send({ message: 'MFA disabled' });
    } catch (err) {
      return handleError(reply, err);
    }
  });
};

// Extend Fastify instance type to expose prisma
declare module 'fastify' {
  interface FastifyInstance {
    prisma: import('@prisma/client').PrismaClient;
  }
}
