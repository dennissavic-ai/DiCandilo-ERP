import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3001),
  HOST: z.string().default('0.0.0.0'),

  // Database
  DATABASE_URL: z.string(),

  // Redis
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // JWT
  JWT_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRES: z.string().default('15m'),
  JWT_REFRESH_EXPIRES: z.string().default('7d'),

  // App
  FRONTEND_URL: z.string().default('http://localhost:3000'),
  API_PREFIX: z.string().default('/api/v1'),

  // Email (SMTP)
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  EMAIL_FROM: z.string().default('noreply@erp.local'),

  // AWS S3 (for file storage)
  AWS_REGION: z.string().default('us-east-1'),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  S3_BUCKET: z.string().optional(),

  // Rate limiting
  RATE_LIMIT_MAX: z.coerce.number().default(100),
  RATE_LIMIT_WINDOW: z.coerce.number().default(60000),
  // Stricter limit for authentication endpoints (SOC2 CC6 / OWASP API2)
  AUTH_RATE_LIMIT_MAX: z.coerce.number().default(10),
  AUTH_RATE_LIMIT_WINDOW: z.coerce.number().default(60000),

  // Account lockout (SOC2 CC6 / ISO 27001 A.9.4.2)
  MAX_LOGIN_ATTEMPTS: z.coerce.number().default(5),
  LOCKOUT_DURATION_MINUTES: z.coerce.number().default(15),

  // MFA / TOTP (SOC2 CC6 / NIST SP 800-63B AAL2)
  MFA_ISSUER: z.string().default('DiCandilo ERP'),

  // Swagger (OWASP API9 — disable in production by default)
  SWAGGER_ENABLED: z
    .string()
    .transform((v) => v === 'true')
    .default('false'),

  // Logging
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
