import { FastifyRequest, FastifyReply } from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/database';
import { JWTPayload } from './auth.middleware';

/**
 * Write an audit log entry. Call this from route handlers after successful mutations.
 */
export async function writeAuditLog(
  request: FastifyRequest,
  action: string,
  entity: string,
  entityId: string,
  oldValues?: Record<string, unknown> | null,
  newValues?: Record<string, unknown> | null
): Promise<void> {
  const payload = request.user as unknown as JWTPayload;
  if (!payload?.sub) return;

  await prisma.auditLog.create({
    data: {
      userId: payload.sub,
      action,
      entity,
      entityId,
      oldValues: oldValues as Prisma.InputJsonValue ?? undefined,
      newValues: newValues as Prisma.InputJsonValue ?? undefined,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? undefined,
    },
  });
}
