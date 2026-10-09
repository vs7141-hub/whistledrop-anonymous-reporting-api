import { NextFunction, Request, Response } from 'express';
import { isTest } from '../config/env';

/**
 * Minimal access log: METHOD  ROUTE-PATTERN  STATUS  DURATION.
 * It logs the route PATTERN ("/cases/:caseCode"), never the real URL, so case
 * codes never reach the logs. No IPs, headers, query strings or bodies either.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction) {
  if (isTest) return next();
  const start = Date.now();
  res.on('finish', () => {
    const pattern = req.route ? `${req.baseUrl}${req.route.path}` : '(unmatched)';
    console.log(`${req.method} ${pattern} ${res.statusCode} ${Date.now() - start}ms`);
  });
  next();
}
