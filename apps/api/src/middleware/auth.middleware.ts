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

export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    await request.jwtVerify();
    const payload = request.user as unknown as JWTPayload;

    // Ensure user is still active
    const user = await prisma.user.findFirst({
      where: { id: payload.sub, isActive: true, deletedAt: null },
      select: { id: true },
    });

    if (!user) {
      return reply.status(401).send({ error: 'Unauthorized', message: 'User account is inactive or not found' });
    }
  } catch (err) {
    return reply.status(401).send({ error: 'Unauthorized', message: 'Invalid or expired token' });
  }
}

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
      return reply.status(403).send({
        error: 'Forbidden',
        message: `Missing permission: ${module}:${action}`,
      });
    }
  };
}

/**
 * Require the user to have admin role.
 */
export async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const payload = request.user as unknown as JWTPayload;
  if (payload.roleName !== 'Admin') {
    return reply.status(403).send({ error: 'Forbidden', message: 'Admin access required' });
  }
}
