import jwt, { SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { DUMMY_HASH, hashPassword, verifyPassword } from '../utils/password';
import { AppError, unauthorized } from '../utils/errors';
import { Prisma } from '../generated/prisma/client';
import { CreateModeratorInput, LoginInput } from '../schemas';

export async function login({ email, password }: LoginInput) {
  const moderator = await prisma.moderator.findUnique({ where: { email } });

  // Always run bcrypt (even for unknown emails) and always return the SAME
  // message, so an attacker cannot learn which emails are registered.
  const valid = await verifyPassword(password, moderator?.passwordHash ?? DUMMY_HASH);
  if (!moderator || !valid) throw unauthorized('Invalid email or password');

  const token = jwt.sign({ role: moderator.role }, env.JWT_SECRET, {
    algorithm: 'HS256',
    subject: moderator.id,
    expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn'],
  });
  return {
    token,
    tokenType: 'Bearer',
    expiresIn: env.JWT_EXPIRES_IN,
    moderator: { id: moderator.id, email: moderator.email, role: moderator.role },
  };
}

export async function createModerator(input: CreateModeratorInput) {
  try {
    return await prisma.moderator.create({
      data: { email: input.email, passwordHash: await hashPassword(input.password), role: input.role },
      // passwordHash is deliberately NOT selected, so it can never leak.
      select: { id: true, email: true, role: true, createdAt: true },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new AppError(409, 'MODERATOR_EXISTS', 'A moderator with this email already exists');
    }
    throw err;
  }
}
