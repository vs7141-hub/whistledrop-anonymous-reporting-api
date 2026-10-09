import { NextFunction, Request, Response } from 'express';
import { ZodType } from 'zod';
import { AppError } from '../utils/errors';

type Schemas = { body?: ZodType; query?: ZodType; params?: ZodType };

/**
 * Validates and REPLACES req.body / req.query / req.params with the parsed
 * result, so controllers only ever see clean, typed, trimmed data.
 *
 *  - body/query failures -> 422 VALIDATION_ERROR (request is well-formed but the values are unacceptable)
 *  - params failures     -> 400 (the identifier in the URL is malformed, so it cannot refer to anything)
 */
export const validate = (schemas: Schemas) => (req: Request, _res: Response, next: NextFunction) => {
  for (const target of ['params', 'query', 'body'] as const) {
    const schema = schemas[target];
    if (!schema) continue;
    const result = schema.safeParse(req[target]);
    if (!result.success) {
      const details = result.error.issues.map((i) => ({
        field: i.path.join('.') || target,
        message: i.message,
      }));
      if (target === 'params') {
        return next(new AppError(400, 'INVALID_PARAMETER', 'A URL parameter is malformed', details));
      }
      return next(new AppError(422, 'VALIDATION_ERROR', 'Request validation failed', details));
    }
    (req as unknown as Record<string, unknown>)[target] = result.data;
  }
  next();
};
