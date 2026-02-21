import argon2 from 'argon2';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../../config/database';
import { env } from '../../config/env';
import { AppError, NotFoundError } from '../../utils/errors';
import type { FastifyInstance } from 'fastify';

export interface LoginDTO {
  email: string;
  password: string;
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
}

export class AuthService {
  constructor(private readonly fastify: FastifyInstance) {}

  async login(dto: LoginDTO, ipAddress?: string): Promise<TokenPair> {
    const user = await prisma.user.findUnique({
      where: { email: dto.email.toLowerCase().trim() },
      include: { role: true },
    });

    if (!user || !(await argon2.verify(user.passwordHash, dto.password))) {
      throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
    }

    if (!user.isActive || user.deletedAt) {
      throw new AppError('Your account has been deactivated', 401, 'ACCOUNT_INACTIVE');
    }

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return this.generateTokenPair(user);
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

  async logout(refreshToken: string): Promise<void> {
    await prisma.refreshToken.deleteMany({ where: { token: refreshToken } });
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundError('User', userId);

    if (!(await argon2.verify(user.passwordHash, currentPassword))) {
      throw new AppError('Current password is incorrect', 400, 'WRONG_PASSWORD');
    }

    const passwordHash = await argon2.hash(newPassword);
    await prisma.user.update({ where: { id: userId }, data: { passwordHash } });

    // Invalidate all refresh tokens
    await prisma.refreshToken.deleteMany({ where: { userId } });
  }

  /**
   * Bootstrap: create a company + admin user (used during initial setup).
   */
  async register(dto: RegisterDTO): Promise<TokenPair> {
    const existing = await prisma.user.findUnique({
      where: { email: dto.email.toLowerCase().trim() },
    });
    if (existing) {
      throw new AppError('Email already in use', 409, 'EMAIL_IN_USE');
    }

    const passwordHash = await argon2.hash(dto.password);

    // Create or find Admin role
    let adminRole = await prisma.role.findFirst({ where: { name: 'Admin' } });
    if (!adminRole) {
      adminRole = await prisma.role.create({
        data: {
          name: 'Admin',
          description: 'Full system access',
          isSystem: true,
        },
      });
    }

    // Create company + default branch + admin user in one transaction
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
          email: dto.email.toLowerCase().trim(),
          passwordHash,
          firstName: dto.firstName,
          lastName: dto.lastName,
        },
        include: { role: true },
      });

      // Seed GL accounts for the new company
      await seedDefaultGLAccounts(tx, company.id);

      return user;
    });

    return this.generateTokenPair(result);
  }

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
      data: {
        userId: user.id,
        token: refreshTokenValue,
        expiresAt: refreshExpiry,
      },
    });

    return { accessToken, refreshToken: refreshTokenValue };
  }
}

async function seedDefaultGLAccounts(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  companyId: string
): Promise<void> {
  const accounts = [
    // Assets
    { code: '1000', name: 'Cash', type: 'ASSET', normalBalance: 'DEBIT' },
    { code: '1100', name: 'Accounts Receivable', type: 'ASSET', normalBalance: 'DEBIT' },
    { code: '1200', name: 'Inventory', type: 'ASSET', normalBalance: 'DEBIT' },
    { code: '1500', name: 'Property & Equipment', type: 'ASSET', normalBalance: 'DEBIT' },
    // Liabilities
    { code: '2000', name: 'Accounts Payable', type: 'LIABILITY', normalBalance: 'CREDIT' },
    { code: '2100', name: 'Accrued Liabilities', type: 'LIABILITY', normalBalance: 'CREDIT' },
    { code: '2200', name: 'Sales Tax Payable', type: 'LIABILITY', normalBalance: 'CREDIT' },
    // Equity
    { code: '3000', name: "Owner's Equity", type: 'EQUITY', normalBalance: 'CREDIT' },
    { code: '3100', name: 'Retained Earnings', type: 'EQUITY', normalBalance: 'CREDIT' },
    // Revenue
    { code: '4000', name: 'Sales Revenue', type: 'REVENUE', normalBalance: 'CREDIT' },
    { code: '4100', name: 'Service Revenue', type: 'REVENUE', normalBalance: 'CREDIT' },
    // COGS
    { code: '5000', name: 'Cost of Goods Sold', type: 'COGS', normalBalance: 'DEBIT' },
    { code: '5100', name: 'Processing Costs', type: 'COGS', normalBalance: 'DEBIT' },
    // Expenses
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
