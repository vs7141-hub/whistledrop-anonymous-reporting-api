import { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../utils/errors';
import { isProd, isTest } from '../config/env';

export function notFoundHandler(_req: Request, res: Response) {
  // Deliberately does not echo the requested path back.
  res.status(404).json({ success: false, error: { code: 'ROUTE_NOT_FOUND', message: 'Route not found' } });
}

/**
 * The ONE place where errors become HTTP responses, with one consistent shape:
 *   { success: false, error: { code, message, details? } }
 * Unknown errors (bugs, DB failures) are logged server-side and the client only
 * gets a generic 500 - no stack trace, no SQL, no internals.
 */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) },
    });
  }

  if (err instanceof ZodError) {
    return res.status(422).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      },
    });
  }

  // Errors raised by express.json() before our code runs
  const e = err as { type?: string };
  if (e?.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON' } });
  }
  if (e?.type === 'entity.too.large') {
    return res.status(413).json({ success: false, error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' } });
  }

  if (!isTest) {
    // In production log only the error TYPE: messages/stacks of DB errors can contain user data.
    const name = err instanceof Error ? err.name : 'UnknownError';
    console.error(isProd ? `Unhandled error: ${name}` : err);
  }
  return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on our side' } });
}
