import argon2 from 'argon2';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../../config/database';
import { env } from '../../config/env';
import { AppError, NotFoundError } from '../../utils/errors';
import { validatePasswordComplexity } from '../../utils/password';
import type { FastifyInstance } from 'fastify';

export interface LoginDTO {
  email: string;
  password: string;
  /** TOTP code — required when user has MFA enabled */
  totpCode?: string;
}

export interface RegisterDTO {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  companyName: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  requirePasswordChange?: boolean;
}

// ─── Security event helper ────────────────────────────────────────────────────

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

// ─── AuthService ──────────────────────────────────────────────────────────────

export class AuthService {
  constructor(private readonly fastify: FastifyInstance) {}

  async login(
    dto: LoginDTO,
    ipAddress?: string,
    userAgent?: string
  ): Promise<TokenPair> {
    const email = dto.email.toLowerCase().trim();

    const user = await prisma.user.findUnique({
      where: { email },
      include: { role: true },
    });

    // --- Credential verification ---
    const credentialsValid =
      user != null && (await argon2.verify(user.passwordHash, dto.password));

    if (!credentialsValid) {
      await logSecurityEvent('LOGIN_FAILURE', {
        userId: user?.id,
        companyId: user?.companyId,
        ipAddress,
        userAgent,
        severity: 'WARNING',
        metadata: { email },
      });
      throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
    }

    if (!user.isActive || user.deletedAt) {
      throw new AppError('Your account has been deactivated', 401, 'ACCOUNT_INACTIVE');
    }


    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    await logSecurityEvent('LOGIN_SUCCESS', {
      userId: user.id,
      companyId: user.companyId,
      ipAddress,
      userAgent,
      metadata: { email },
    });

    const tokens = await this.generateTokenPair(user);
    return {
      ...tokens,
      requirePasswordChange: user.requirePasswordChange,
    };
  }

  async refreshToken(token: string): Promise<TokenPair> {
    const stored = await prisma.refreshToken.findUnique({
      where: { token },
      include: { user: { include: { role: true } } },
    });

    if (!stored || stored.expiresAt < new Date()) {
      throw new AppError('Invalid or expired refresh token', 401, 'INVALID_REFRESH_TOKEN');
    }

    if (!stored.user.isActive || stored.user.deletedAt) {
      throw new AppError('Account inactive', 401, 'ACCOUNT_INACTIVE');
    }

    // Rotate refresh token
    await prisma.refreshToken.delete({ where: { id: stored.id } });

    return this.generateTokenPair(stored.user);
  }

  async logout(
    refreshToken: string,
    userId?: string,
    companyId?: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<void> {
    await prisma.refreshToken.deleteMany({ where: { token: refreshToken } });
    if (userId) {
      await logSecurityEvent('LOGOUT', {
        userId,
        companyId,
        ipAddress,
        userAgent,
      });
    }
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<void> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundError('User', userId);

    if (!(await argon2.verify(user.passwordHash, currentPassword))) {
      await logSecurityEvent('LOGIN_FAILURE', {
        userId,
        companyId: user.companyId,
        ipAddress,
        userAgent,
        severity: 'WARNING',
        metadata: { reason: 'wrong_current_password_on_change' },
      });
      throw new AppError('Current password is incorrect', 400, 'WRONG_PASSWORD');
    }

    // Complexity validation (NIST SP 800-63B / ISO 27001 A.9.4.3)
    const complexity = validatePasswordComplexity(newPassword);
    if (!complexity.valid) {
      throw new AppError(complexity.errors.join('. '), 422, 'WEAK_PASSWORD');
    }

    const passwordHash = await argon2.hash(newPassword);
    await prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        passwordChangedAt: new Date(),
        requirePasswordChange: false,
        loginAttempts: 0,
        lockedUntil: null,
      },
    });

    // Invalidate all refresh tokens on password change (ISO 27001 A.9.4.2)
    await prisma.refreshToken.deleteMany({ where: { userId } });

    await logSecurityEvent('PASSWORD_CHANGE', {
      userId,
      companyId: user.companyId,
      ipAddress,
      userAgent,
    });
  }

  // ─── MFA / TOTP ─────────────────────────────────────────────────────────────

  /**
   * Generate a new TOTP secret and return the otpauth URI for QR display.
   * The secret is NOT yet saved — the user must confirm a valid code first.
   */
  generateMfaSecret(_userEmail: string): { secret: string; otpauthUrl: string } {
    throw new AppError('MFA not available in this build', 501, 'MFA_UNAVAILABLE');
  }

  async enableMfa(
    _userId: string,
    _secret: string,
    _totpCode: string,
  ): Promise<void> {
    throw new AppError('MFA not available in this build', 501, 'MFA_UNAVAILABLE');
  }

  async disableMfa(
    userId: string,
    currentPassword: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<void> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundError('User', userId);

    if (!(await argon2.verify(user.passwordHash, currentPassword))) {
      throw new AppError('Incorrect password', 400, 'WRONG_PASSWORD');
    }

    await prisma.user.update({
      where: { id: userId },
      data: { mfaEnabled: false, mfaSecret: null },
    });

    await logSecurityEvent('MFA_DISABLED', {
      userId,
      companyId: user.companyId,
      ipAddress,
      userAgent,
      severity: 'WARNING',
    });
  }

  /**
   * Unlock a locked account (admin action).
   */
  async unlockAccount(
    targetUserId: string,
    actorUserId: string,
    ipAddress?: string
  ): Promise<void> {
    const user = await prisma.user.findUnique({ where: { id: targetUserId } });
    if (!user) throw new NotFoundError('User', targetUserId);

    await prisma.user.update({
      where: { id: targetUserId },
      data: { loginAttempts: 0, lockedUntil: null },
    });

    await logSecurityEvent('ACCOUNT_UNLOCKED', {
      userId: targetUserId,
      companyId: user.companyId,
      ipAddress,
      metadata: { unlockedBy: actorUserId },
    });
  }

  /**
   * Bootstrap: create a company + admin user (used during initial setup).
   */
  async register(dto: RegisterDTO): Promise<TokenPair> {
    const email = dto.email.toLowerCase().trim();

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new AppError('Email already in use', 409, 'EMAIL_IN_USE');
    }

    // Enforce password complexity on registration
    const complexity = validatePasswordComplexity(dto.password);
    if (!complexity.valid) {
      throw new AppError(complexity.errors.join('. '), 422, 'WEAK_PASSWORD');
    }

    const passwordHash = await argon2.hash(dto.password);

    let adminRole = await prisma.role.findFirst({ where: { name: 'Admin' } });
    if (!adminRole) {
      adminRole = await prisma.role.create({
        data: { name: 'Admin', description: 'Full system access', isSystem: true },
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      const company = await tx.company.create({
        data: { name: dto.companyName },
      });

      const branch = await tx.branch.create({
        data: {
          companyId: company.id,
          code: 'MAIN',
          name: 'Main Branch',
          isDefault: true,
        },
      });

      const user = await tx.user.create({
        data: {
          companyId: company.id,
          branchId: branch.id,
          roleId: adminRole!.id,
          email,
          passwordHash,
          firstName: dto.firstName,
          lastName: dto.lastName,
          passwordChangedAt: new Date(),
        },
        include: { role: true },
      });

      await seedDefaultGLAccounts(tx, company.id);

      return user;
    });

    await logSecurityEvent('ACCOUNT_CREATED', {
      userId: result.id,
      companyId: result.companyId,
      metadata: { email },
    });

    return this.generateTokenPair(result);
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  private async generateTokenPair(user: {
    id: string;
    email: string;
    companyId: string;
    branchId: string | null;
    roleId: string;
    role: { name: string };
  }): Promise<TokenPair> {
    const payload = {
      sub: user.id,
      email: user.email,
      companyId: user.companyId,
      branchId: user.branchId,
      roleId: user.roleId,
      roleName: user.role.name,
    };

    const accessToken = this.fastify.jwt.sign(payload);

    const refreshTokenValue = uuidv4();
    const refreshExpiry = new Date();
    refreshExpiry.setDate(refreshExpiry.getDate() + 7); // 7 days

    await prisma.refreshToken.create({
      data: { userId: user.id, token: refreshTokenValue, expiresAt: refreshExpiry },
    });

    return { accessToken, refreshToken: refreshTokenValue };
  }
}

// ─── GL account seeding ───────────────────────────────────────────────────────

async function seedDefaultGLAccounts(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  companyId: string
): Promise<void> {
  const accounts = [
    { code: '1000', name: 'Cash', type: 'ASSET', normalBalance: 'DEBIT' },
    { code: '1100', name: 'Accounts Receivable', type: 'ASSET', normalBalance: 'DEBIT' },
    { code: '1200', name: 'Inventory', type: 'ASSET', normalBalance: 'DEBIT' },
    { code: '1500', name: 'Property & Equipment', type: 'ASSET', normalBalance: 'DEBIT' },
    { code: '2000', name: 'Accounts Payable', type: 'LIABILITY', normalBalance: 'CREDIT' },
    { code: '2100', name: 'Accrued Liabilities', type: 'LIABILITY', normalBalance: 'CREDIT' },
    { code: '2200', name: 'Sales Tax Payable', type: 'LIABILITY', normalBalance: 'CREDIT' },
    { code: '3000', name: "Owner's Equity", type: 'EQUITY', normalBalance: 'CREDIT' },
    { code: '3100', name: 'Retained Earnings', type: 'EQUITY', normalBalance: 'CREDIT' },
    { code: '4000', name: 'Sales Revenue', type: 'REVENUE', normalBalance: 'CREDIT' },
    { code: '4100', name: 'Service Revenue', type: 'REVENUE', normalBalance: 'CREDIT' },
    { code: '5000', name: 'Cost of Goods Sold', type: 'COGS', normalBalance: 'DEBIT' },
    { code: '5100', name: 'Processing Costs', type: 'COGS', normalBalance: 'DEBIT' },
    { code: '6000', name: 'Wages & Salaries', type: 'EXPENSE', normalBalance: 'DEBIT' },
    { code: '6100', name: 'Freight & Shipping', type: 'EXPENSE', normalBalance: 'DEBIT' },
    { code: '6200', name: 'Utilities', type: 'EXPENSE', normalBalance: 'DEBIT' },
    { code: '6300', name: 'General & Administrative', type: 'EXPENSE', normalBalance: 'DEBIT' },
  ];

  for (const acct of accounts) {
    await (tx as typeof prisma).gLAccount.create({
      data: {
        companyId,
        code: acct.code,
        name: acct.name,
        type: acct.type as 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE' | 'COGS',
        normalBalance: acct.normalBalance as 'DEBIT' | 'CREDIT',
        isSystemAccount: true,
      },
    });
  }
}
