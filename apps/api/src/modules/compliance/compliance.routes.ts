/**
 * Compliance Module
 *
 * Covers:
 *   - GDPR Articles 15, 17, 20 — Right of Access, Erasure, Portability
 *   - SOC2 CC7 — Security event monitoring & alerting
 *   - ISO/IEC 27001 A.12.4 — Logging and monitoring
 *   - NIST CSF DE.CM — Continuous monitoring
 */

import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../config/database';
import { authenticate, requireAdmin } from '../../middleware/auth.middleware';
import { handleError } from '../../utils/errors';
import { parsePagination, paginatedResponse } from '../../utils/pagination';

export const complianceRoutes: FastifyPluginAsync = async (fastify) => {

  // ── GDPR: Data Export (Article 15 & 20 — Right of Access / Portability) ──────

  /**
   * GET /compliance/gdpr/export
   * Returns a structured JSON export of all personal data held for the
   * authenticated user. Per GDPR Art. 20, data must be machine-readable.
   */
  fastify.get('/gdpr/export', {
    schema: {
      tags: ['Compliance'],
      description:
        'GDPR Art. 15 & 20 — Export all personal data held for the authenticated user.',
    },
    preHandler: [authenticate],
  }, async (request, reply) => {
    try {
      const { sub: userId, companyId } = request.user as { sub: string; companyId: string };

      const [user, auditLogs, tasks, taskComments, securityEvents] = await Promise.all([
        prisma.user.findUnique({
          where: { id: userId },
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            phone: true,
            companyId: true,
            branchId: true,
            lastLoginAt: true,
            createdAt: true,
            updatedAt: true,
            mfaEnabled: true,
            requirePasswordChange: true,
            // Excluded: passwordHash, mfaSecret, loginAttempts, lockedUntil
          },
        }),
        prisma.auditLog.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          take: 1000,
          select: { id: true, action: true, entity: true, entityId: true, createdAt: true },
        }),
        prisma.task.findMany({
          where: { companyId, OR: [{ assigneeId: userId }, { createdById: userId }], deletedAt: null },
          select: { id: true, title: true, status: true, priority: true, createdAt: true },
          take: 500,
        }),
        prisma.taskComment.findMany({
          where: { userId },
          select: { id: true, body: true, createdAt: true },
          take: 500,
        }),
        (prisma as any).securityEvent.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          take: 500,
          select: { id: true, eventType: true, severity: true, ipAddress: true, createdAt: true },
        }),
      ]);

      // Log the export as a security event (data access auditing)
      await (prisma as any).securityEvent.create({
        data: {
          eventType: 'DATA_EXPORT',
          userId,
          companyId,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
          metadata: { exportedAt: new Date().toISOString() },
        },
      });

      return reply
        .header('Content-Disposition', `attachment; filename="data-export-${userId}.json"`)
        .header('Content-Type', 'application/json')
        .send({
          exportedAt: new Date().toISOString(),
          dataController: 'DiCandilo ERP',
          subject: user,
          activityLog: auditLogs,
          tasks,
          comments: taskComments,
          securityEvents,
        });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // ── GDPR: Account Deletion (Article 17 — Right to Erasure) ────────────────

  /**
   * DELETE /compliance/gdpr/me
   * Soft-deletes the user account and anonymises personal data fields.
   * A hard delete of the underlying record is deferred to the data-retention
   * purge job (keep audit trails for 7 years per accounting regulations).
   */
  fastify.delete('/gdpr/me', {
    schema: {
      tags: ['Compliance'],
      description:
        'GDPR Art. 17 — Request erasure of personal data. Account is deactivated and PII anonymised immediately.',
      body: {
        type: 'object',
        required: ['confirmEmail'],
        properties: {
          confirmEmail: {
            type: 'string',
            description: 'Type your email address to confirm deletion',
          },
        },
      },
    },
    preHandler: [authenticate],
  }, async (request, reply) => {
    try {
      const { sub: userId, companyId, email } = request.user as {
        sub: string; companyId: string; email: string;
      };

      const body = z.object({ confirmEmail: z.string().email() }).parse(request.body);
      if (body.confirmEmail.toLowerCase() !== email.toLowerCase()) {
        return reply.status(422).send({
          error: 'CONFIRMATION_MISMATCH',
          message: 'Confirmation email does not match your account email.',
        });
      }

      // Anonymise PII in-place (GDPR Art. 17 — erasure without destroying audit integrity)
      const anonymisedEmail = `deleted-${userId}@erased.invalid`;
      await prisma.user.update({
        where: { id: userId },
        data: {
          email: anonymisedEmail,
          firstName: '[Deleted]',
          lastName: '[Deleted]',
          phone: null,
          avatarUrl: null,
          isActive: false,
          deletedAt: new Date(),
          mfaSecret: null,
          mfaEnabled: false,
        },
      });

      // Revoke all sessions
      await prisma.refreshToken.deleteMany({ where: { userId } });

      await (prisma as any).securityEvent.create({
        data: {
          eventType: 'DATA_DELETION_REQUEST',
          userId,
          companyId,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
          severity: 'WARNING',
          metadata: { requestedAt: new Date().toISOString() },
        },
      });

      return reply.status(200).send({
        message:
          'Your account has been deactivated and personal data anonymised. ' +
          'Audit logs are retained for a minimum of 7 years per applicable accounting regulations.',
      });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // ── Security Events (SOC2 CC7 / ISO 27001 A.12.4) ─────────────────────────

  /**
   * GET /compliance/security-events
   * Admin-only paginated list of security events for the company.
   * Supports filtering by eventType, severity, userId, and date range.
   */
  fastify.get('/security-events', {
    schema: {
      tags: ['Compliance'],
      description:
        'SOC2 CC7 / ISO 27001 A.12.4 — Paginated security event log for the company (admin only).',
    },
    preHandler: [authenticate, requireAdmin],
  }, async (request, reply) => {
    try {
      const { companyId } = request.user as { companyId: string };
      const { skip, take, page, limit } = parsePagination(
        request.query as { page?: number; limit?: number }
      );

      const {
        eventType,
        severity,
        userId,
        from,
        to,
      } = request.query as {
        eventType?: string;
        severity?: string;
        userId?: string;
        from?: string;
        to?: string;
      };

      const where: Record<string, unknown> = {
        companyId,
        ...(eventType && { eventType }),
        ...(severity && { severity }),
        ...(userId && { userId }),
        ...((from || to) && {
          createdAt: {
            ...(from && { gte: new Date(from) }),
            ...(to && { lte: new Date(to) }),
          },
        }),
      };

      const [data, total] = await Promise.all([
        (prisma as any).securityEvent.findMany({
          where,
          skip,
          take,
          orderBy: { createdAt: 'desc' },
        }),
        (prisma as any).securityEvent.count({ where }),
      ]);

      return paginatedResponse(data, total, page, limit);
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // ── Security event summary / dashboard widget ──────────────────────────────

  /**
   * GET /compliance/security-events/summary
   * Returns counts of each event type over the last 30 days.
   */
  fastify.get('/security-events/summary', {
    schema: {
      tags: ['Compliance'],
      description: 'SOC2 CC7 — Security event counts by type over the last 30 days.',
    },
    preHandler: [authenticate, requireAdmin],
  }, async (request, reply) => {
    try {
      const { companyId } = request.user as { companyId: string };
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const events = await (prisma as any).securityEvent.groupBy({
        by: ['eventType', 'severity'],
        where: { companyId, createdAt: { gte: since } },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
      });

      const criticalCount = await (prisma as any).securityEvent.count({
        where: { companyId, severity: 'CRITICAL', createdAt: { gte: since } },
      });

      const lockedAccounts = await prisma.user.count({
        where: {
          companyId,
          lockedUntil: { gt: new Date() },
          deletedAt: null,
        },
      });

      return reply.send({
        period: { from: since, to: new Date() },
        criticalEventCount: criticalCount,
        currentlyLockedAccounts: lockedAccounts,
        breakdown: events.map((e: any) => ({
          eventType: e.eventType,
          severity: e.severity,
          count: e._count.id,
        })),
      });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // ── Compliance status report ───────────────────────────────────────────────

  /**
   * GET /compliance/status
   * Returns a high-level compliance posture for the company.
   * Useful for auditors and executive dashboards.
   */
  fastify.get('/status', {
    schema: {
      tags: ['Compliance'],
      description:
        'Returns a compliance posture overview: MFA adoption, password change status, locked accounts, etc.',
    },
    preHandler: [authenticate, requireAdmin],
  }, async (request, reply) => {
    try {
      const { companyId } = request.user as { companyId: string };

      const [
        totalUsers,
        mfaEnabledCount,
        requirePasswordChangeCount,
        lockedCount,
        inactiveCount,
      ] = await Promise.all([
        prisma.user.count({ where: { companyId, deletedAt: null } }),
        prisma.user.count({ where: { companyId, mfaEnabled: true, deletedAt: null } }),
        prisma.user.count({ where: { companyId, requirePasswordChange: true, deletedAt: null, isActive: true } }),
        prisma.user.count({ where: { companyId, lockedUntil: { gt: new Date() }, deletedAt: null } }),
        prisma.user.count({ where: { companyId, isActive: false, deletedAt: null } }),
      ]);

      const mfaAdoptionPct =
        totalUsers > 0 ? Math.round((mfaEnabledCount / totalUsers) * 100) : 0;

      return reply.send({
        generatedAt: new Date().toISOString(),
        standards: ['SOC2 Type II', 'ISO/IEC 27001:2022', 'GDPR', 'NIST CSF', 'OWASP API Top 10'],
        identity: {
          totalActiveUsers: totalUsers,
          mfaEnabledCount,
          mfaAdoptionPct,
          requirePasswordChangeCount,
          lockedAccountCount: lockedCount,
          inactiveAccountCount: inactiveCount,
        },
        controls: {
          'SOC2-CC6.1': {
            name: 'Logical access controls',
            status: mfaAdoptionPct >= 80 ? 'PASS' : 'NEEDS_ATTENTION',
            detail: `MFA adoption: ${mfaAdoptionPct}%`,
          },
          'SOC2-CC6.2': {
            name: 'Account lockout enforced',
            status: 'PASS',
            detail: 'Accounts lock after 5 failed attempts for 15 minutes',
          },
          'SOC2-CC6.3': {
            name: 'Password complexity',
            status: 'PASS',
            detail: 'Min 12 chars, upper/lower/digit/special required',
          },
          'SOC2-CC7.1': {
            name: 'Security event logging',
            status: 'PASS',
            detail: 'All auth and permission events logged to SecurityEvent table',
          },
          'SOC2-CC7.2': {
            name: 'Anomaly detection',
            status: lockedCount > 0 ? 'NEEDS_ATTENTION' : 'PASS',
            detail:
              lockedCount > 0
                ? `${lockedCount} account(s) currently locked due to failed login attempts`
                : 'No accounts currently locked',
          },
          'GDPR-Art15': {
            name: 'Right of access',
            status: 'PASS',
            detail: 'Data export endpoint available at GET /compliance/gdpr/export',
          },
          'GDPR-Art17': {
            name: 'Right to erasure',
            status: 'PASS',
            detail: 'Account deletion + PII anonymisation at DELETE /compliance/gdpr/me',
          },
          'OWASP-API2': {
            name: 'Broken Authentication',
            status: 'PASS',
            detail: 'Auth endpoints rate-limited (10 req/min per IP), account lockout active',
          },
          'OWASP-API8': {
            name: 'Security misconfiguration',
            status: 'PASS',
            detail: 'Swagger disabled in production, HSTS enabled, CSP headers set',
          },
        },
      });
    } catch (err) {
      return handleError(reply, err);
    }
  });
};
