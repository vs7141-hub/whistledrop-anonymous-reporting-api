import rateLimit from 'express-rate-limit';
import { env } from '../config/env';

const MIN = 60 * 1000;

const make = (windowMs: number, limit: number, message: string, failedOnly = false) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7', // sends RateLimit-* headers
    legacyHeaders: false,
    // For brute-force protection we only count FAILED attempts (status >= 400),
    // so honest users with the right code/password are never slowed down.
    skipSuccessfulRequests: failedOnly,
    handler: (_req, res) => {
      res.status(429).json({ success: false, error: { code: 'RATE_LIMITED', message } });
    },
  });

// Counters live in memory and are keyed by IP only for the length of the window.
// IPs are never written to the database or to logs.
export const globalLimiter = make(15 * MIN, env.GLOBAL_RATE_LIMIT_MAX, 'Too many requests, please try again later.');
export const reportCreateLimiter = make(60 * MIN, env.REPORT_RATE_LIMIT_MAX, 'Too many reports submitted from this network, please try again later.');
export const caseLookupLimiter = make(15 * MIN, env.LOOKUP_FAILED_MAX, 'Too many failed case-code lookups, please try again later.', true);
export const loginLimiter = make(15 * MIN, env.LOGIN_FAILED_MAX, 'Too many failed login attempts, please try again later.', true);
