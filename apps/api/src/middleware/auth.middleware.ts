import { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../config/database';

export interface JWTPayload {
  sub: string;      // userId
  email: string;
  companyId: string;
  branchId?: string;
  roleId: string;
  roleName: string;
  iat: number;
  exp: number;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: JWTPayload;
  }
}

// ─── Security event helper (inline to avoid circular imports) ─────────────────

async function logSecurityEvent(
  eventType: string,
  opts: {
    userId?: string;
    companyId?: string;
    ipAddress?: string;
    userAgent?: string;
    severity?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  try {
    await (prisma as any).securityEvent.create({
      data: {
        eventType,
        severity: opts.severity ?? 'INFO',
        userId: opts.userId,
        companyId: opts.companyId,
        ipAddress: opts.ipAddress,
        userAgent: opts.userAgent,
        metadata: opts.metadata,
      },
    });
  } catch {
    // Never crash the main flow because of a logging failure
  }
}

// ─── authenticate ─────────────────────────────────────────────────────────────

export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    await request.jwtVerify();
    const payload = request.user as unknown as JWTPayload;

    const user = await prisma.user.findFirst({
      where: { id: payload.sub, isActive: true, deletedAt: null },
      select: {
        id: true,
        lockedUntil: true,
        requirePasswordChange: true,
      },
    });

    if (!user) {
      return reply
        .status(401)
        .send({ error: 'Unauthorized', message: 'User account is inactive or not found' });
    }

    // SOC2 CC6 — Block locked accounts even if JWT is still valid
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const minutesLeft = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
      return reply.status(423).send({
        error: 'ACCOUNT_LOCKED',
        message: `Account is temporarily locked. Try again in ${minutesLeft} minute(s).`,
      });
    }

    // SOC2 CC6 — Gate access when a password change is required (e.g., first login)
    // Allow /auth/* routes through so the user can change their password
    const path = request.routeOptions?.url ?? (request as any).url ?? '';
    const isAuthRoute = path.includes('/auth/');
    if (user.requirePasswordChange && !isAuthRoute) {
      return reply.status(403).send({
        error: 'PASSWORD_CHANGE_REQUIRED',
        message: 'You must change your password before continuing.',
      });
    }
  } catch (err) {
    return reply
      .status(401)
      .send({ error: 'Unauthorized', message: 'Invalid or expired token' });
  }
}

// ─── requirePermission ────────────────────────────────────────────────────────

/**
 * Create a permission guard for a specific module/action.
 * Usage: preHandler: [authenticate, requirePermission('inventory', 'create')]
 */
export function requirePermission(module: string, action: string) {
  return async function permissionGuard(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const payload = request.user as unknown as JWTPayload;

    const permission = await prisma.rolePermission.findFirst({
      where: {
        roleId: payload.roleId,
        permission: { module, action },
      },
    });

    if (!permission) {
      // SOC2 CC7 / ISO 27001 A.12.4 — Log authorisation failures
      await logSecurityEvent('PERMISSION_DENIED', {
        userId: payload.sub,
        companyId: payload.companyId,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
        severity: 'WARNING',
        metadata: {
          module,
          action,
          path: (request as any).url,
          method: request.method,
        },
      });

      return reply.status(403).send({
        error: 'Forbidden',
        message: `Missing permission: ${module}:${action}`,
      });
    }
  };
}

// ─── requireAdmin ─────────────────────────────────────────────────────────────

export async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const payload = request.user as unknown as JWTPayload;
  if (payload.roleName !== 'Admin') {
    await logSecurityEvent('PERMISSION_DENIED', {
      userId: payload.sub,
      companyId: payload.companyId,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
      severity: 'WARNING',
      metadata: {
        required: 'Admin',
        actual: payload.roleName,
        path: (request as any).url,
      },
    });
    return reply.status(403).send({ error: 'Forbidden', message: 'Admin access required' });
  }
}
