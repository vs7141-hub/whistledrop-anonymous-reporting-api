import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { Role } from '../generated/prisma/enums';
import { forbidden, unauthorized } from '../utils/errors';
import { asyncHandler } from '../utils/asyncHandler';

export type AuthUser = { id: string; role: Role };

/**
 * AUTHENTICATION: "who are you?"  -> 401 if we cannot tell.
 * Verifies the JWT, then re-loads the moderator from the DB so that a deleted
 * or demoted account stops working immediately, not when the token expires.
 */
export const authenticate = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) throw unauthorized();

  let payload: jwt.JwtPayload;
  try {
    // Pin the algorithm: never let the token choose how it is verified.
    payload = jwt.verify(header.slice(7), env.JWT_SECRET, { algorithms: ['HS256'] }) as jwt.JwtPayload;
  } catch {
    throw unauthorized('Invalid or expired token');
  }
  if (typeof payload.sub !== 'string') throw unauthorized('Invalid or expired token');

  const moderator = await prisma.moderator.findUnique({
    where: { id: payload.sub },
    select: { id: true, role: true },
  });
  if (!moderator) throw unauthorized('Invalid or expired token');

  res.locals.user = { id: moderator.id, role: moderator.role } satisfies AuthUser;
  next();
});

/** AUTHORIZATION: "are you allowed to do this?" -> 403 if not. Must run after authenticate. */
export const authorize =
  (...roles: Role[]) =>
  (_req: Request, res: Response, next: NextFunction) => {
    const user = res.locals.user as AuthUser | undefined;
    if (!user) return next(unauthorized());
    if (!roles.includes(user.role)) return next(forbidden());
    next();
  };
