import 'dotenv/config';
import { z } from 'zod';

/**
 * All configuration comes from environment variables and is validated ONCE at
 * startup. If anything is missing/weak the app refuses to start ("fail fast")
 * instead of running with an insecure default.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // Secrets: no defaults on purpose, and a minimum length.
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('1h'),
  CASE_CODE_PEPPER: z.string().min(32, 'CASE_CODE_PEPPER must be at least 32 characters'),

  // Comma-separated list of browser origins allowed to call the API. Empty = none.
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((s) => s.split(',').map((o) => o.trim()).filter(Boolean)),
  // Number of reverse proxies in front of the app (so rate limiting sees real client IPs).
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),

  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),

  // Rate-limit thresholds (windows are fixed in middleware/rateLimiters.ts)
  GLOBAL_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(300),
  REPORT_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),
  LOOKUP_FAILED_MAX: z.coerce.number().int().min(1).default(10),
  LOGIN_FAILED_MAX: z.coerce.number().int().min(1).default(5),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:');
  for (const issue of parsed.error.issues) {
    console.error(` - ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
