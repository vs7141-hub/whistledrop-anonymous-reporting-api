import { Response } from 'express';

/** Every success response looks like { success: true, data, meta? }. */
export function sendSuccess(res: Response, data: unknown, status = 200, meta?: unknown) {
  return res.status(status).json({ success: true, data, ...(meta ? { meta } : {}) });
}
