/**
 * Password complexity utilities
 *
 * Enforces NIST SP 800-63B / ISO 27001 A.9.4.3 / SOC2 CC6.1 password policy:
 *   - Minimum 12 characters
 *   - At least one uppercase letter
 *   - At least one lowercase letter
 *   - At least one digit
 *   - At least one special character
 *   - Not a known common password (basic block-list check)
 */

import { z } from 'zod';

const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password12', 'password123', 'password1234',
  'P@ssword1', 'P@ssw0rd', 'Passw0rd!', 'Qwerty123!', 'Admin1234!',
  '12345678', '123456789', '1234567890', 'qwerty123', 'letmein1',
  'welcome1', 'monkey123', 'dragon123', 'master123', 'baseball1',
]);

export interface PasswordValidationResult {
  valid: boolean;
  errors: string[];
}

export function validatePasswordComplexity(password: string): PasswordValidationResult {
  const errors: string[] = [];

  if (password.length < 12) {
    errors.push('Password must be at least 12 characters long');
  }
  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }
  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }
  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one digit');
  }
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(password)) {
    errors.push('Password must contain at least one special character');
  }
  if (COMMON_PASSWORDS.has(password)) {
    errors.push('Password is too common. Please choose a more unique password');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Zod refinement for use in route schemas.
 * Usage: z.string().superRefine(passwordComplexityRefinement)
 */
export function passwordComplexityRefinement(
  value: string,
  ctx: z.RefinementCtx
): void {
  const result = validatePasswordComplexity(value);
  if (!result.valid) {
    result.errors.forEach((msg) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: msg })
    );
  }
}

/**
 * Zod schema for a compliant password field.
 */
export const passwordSchema = z
  .string()
  .min(12, 'Password must be at least 12 characters long')
  .superRefine(passwordComplexityRefinement);
