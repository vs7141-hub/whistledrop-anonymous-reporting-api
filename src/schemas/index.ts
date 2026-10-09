import { z } from 'zod';
import { CASE_CODE_REGEX, normalizeCaseCode } from '../utils/caseCode';
import { Category, ReportStatus, Role } from '../generated/prisma/enums';

const categoryEnum = z.enum(Category, {
  error: `category must be one of: ${Object.values(Category).join(', ')}`,
});
const statusEnum = z.enum(ReportStatus, {
  error: `status must be one of: ${Object.values(ReportStatus).join(', ')}`,
});

// bcrypt only looks at the first 72 BYTES of a password; reject longer ones instead of silently truncating.
const password = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .refine((p) => Buffer.byteLength(p) <= 72, 'Password must be at most 72 bytes');

/**
 * strictObject = reject unknown fields. So if a client sends {"email": "me@x.com"}
 * or {"name": "..."} with a report, it is refused with 422 instead of being
 * silently ignored. The API cannot even be *given* identity data by accident.
 */
export const createReportSchema = z.strictObject({
  category: categoryEnum,
  description: z
    .string({ error: 'description is required' })
    .trim()
    .min(20, 'description must be at least 20 characters')
    .max(5000, 'description must be at most 5000 characters'),
  referenceUrl: z
    .url({ error: 'referenceUrl must be a valid URL' })
    .max(2048)
    .refine((u) => /^https?:\/\//i.test(u), 'referenceUrl must start with http:// or https://')
    .optional(),
});

export const caseCodeParamsSchema = z.object({
  caseCode: z
    .string()
    .max(64)
    .transform(normalizeCaseCode)
    .pipe(z.string().regex(CASE_CODE_REGEX, 'Malformed case code')),
});

export const loginSchema = z.strictObject({
  email: z.email().max(254).transform((e) => e.toLowerCase()),
  password: z.string().min(1).max(128),
});

export const reportIdParamsSchema = z.object({ id: z.uuid({ error: 'Malformed report id' }) });

export const listReportsQuerySchema = z.object({
  category: categoryEnum.optional(),
  status: statusEnum.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const changeStatusSchema = z.strictObject({
  status: statusEnum,
  message: z.string().trim().min(1, 'message is required').max(500, 'message must be at most 500 characters'),
});

export const addUpdateSchema = z.strictObject({
  message: z.string().trim().min(1, 'message is required').max(500, 'message must be at most 500 characters'),
});

export const createModeratorSchema = z.strictObject({
  email: z.email().max(254).transform((e) => e.toLowerCase()),
  password,
  role: z.enum(Role).default('MODERATOR'),
});

export const seedAdminSchema = z.object({ email: z.email().max(254), password });

export type CreateReportInput = z.infer<typeof createReportSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ListReportsQuery = z.infer<typeof listReportsQuerySchema>;
export type ChangeStatusInput = z.infer<typeof changeStatusSchema>;
export type AddUpdateInput = z.infer<typeof addUpdateSchema>;
export type CreateModeratorInput = z.infer<typeof createModeratorSchema>;
