import request from 'supertest';
import app from '../src/app';
import { prisma } from '../src/lib/prisma';
import { hashPassword } from '../src/utils/password';

export { prisma };
export const api = () => request(app);

export const validReport = {
  category: 'SECURITY',
  description: 'The staging server admin panel is exposed to the internet without a password.',
};

export async function resetDb() {
  await prisma.statusUpdate.deleteMany();
  await prisma.report.deleteMany();
  await prisma.moderator.deleteMany();
}

let counter = 0;
export async function createUser(role: 'MODERATOR' | 'ADMIN' = 'MODERATOR') {
  const email = `user${++counter}-${role.toLowerCase()}@example.com`;
  const password = 'correct-horse-battery';
  const user = await prisma.moderator.create({
    data: { email, passwordHash: await hashPassword(password), role },
  });
  return { id: user.id, email, password };
}

export async function loginAs(user: { email: string; password: string }) {
  const res = await api().post('/api/v1/auth/login').send({ email: user.email, password: user.password });
  return res.body.data.token as string;
}

export async function moderatorToken(role: 'MODERATOR' | 'ADMIN' = 'MODERATOR') {
  return loginAs(await createUser(role));
}

/** Submit a report as an anonymous reporter; returns the case code and the report's internal id. */
export async function submitReport(overrides: Record<string, unknown> = {}) {
  const res = await api().post('/api/v1/reports').send({ ...validReport, ...overrides });
  const caseCode = res.body.data.caseCode as string;
  const row = await prisma.report.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
  return { caseCode, id: row.id };
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
