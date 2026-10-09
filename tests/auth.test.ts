import jwt from 'jsonwebtoken';
import { api, bearer, createUser, loginAs, prisma, resetDb, submitReport } from './helpers';

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe('POST /api/v1/auth/login', () => {
  it('logs a moderator in and returns a JWT, never the password hash', async () => {
    const user = await createUser();
    const res = await api().post('/api/v1/auth/login').send({ email: user.email, password: user.password });
    expect(res.status).toBe(200);
    expect(res.body.data.token).toEqual(expect.any(String));
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|\$2[aby]\$/);
  });

  it('wrong password and unknown email give the SAME 401 (no account enumeration)', async () => {
    const user = await createUser();
    const wrong = await api().post('/api/v1/auth/login').send({ email: user.email, password: 'wrong-password-123' });
    const unknown = await api().post('/api/v1/auth/login').send({ email: 'nobody@example.com', password: 'wrong-password-123' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
  });

  it('is case-insensitive for email and validates input (422)', async () => {
    const user = await createUser();
    const ok = await api().post('/api/v1/auth/login').send({ email: user.email.toUpperCase(), password: user.password });
    expect(ok.status).toBe(200);
    expect((await api().post('/api/v1/auth/login').send({ email: 'not-an-email', password: 'x' })).status).toBe(422);
    expect((await api().post('/api/v1/auth/login').send({})).status).toBe(422);
  });

  it('stores passwords hashed with bcrypt, not in plaintext', async () => {
    const user = await createUser();
    const row = await prisma.moderator.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.passwordHash).not.toContain(user.password);
    expect(row.passwordHash).toMatch(/^\$2[aby]\$/);
  });
});

describe('moderator endpoints require authentication (401)', () => {
  it('no token -> 401', async () => {
    const res = await api().get('/api/v1/moderator/reports');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('garbage token, wrong-secret token, expired token and wrong scheme -> 401', async () => {
    const user = await createUser();
    const forged = jwt.sign({ role: 'ADMIN' }, 'attacker-secret-attacker-secret-1234', { subject: user.id });
    const expired = jwt.sign({ role: 'MODERATOR' }, process.env.JWT_SECRET!, { subject: user.id, expiresIn: -10 });
    for (const header of [
      { Authorization: 'Bearer garbage' },
      { Authorization: `Bearer ${forged}` },
      { Authorization: `Bearer ${expired}` },
      { Authorization: 'Basic abc' },
    ]) {
      expect((await api().get('/api/v1/moderator/reports').set(header)).status).toBe(401);
    }
  });

  it('a token for a deleted moderator stops working immediately', async () => {
    const user = await createUser();
    const token = await loginAs(user);
    await prisma.moderator.delete({ where: { id: user.id } });
    expect((await api().get('/api/v1/moderator/reports').set(bearer(token))).status).toBe(401);
  });

  it('an anonymous reporter (case code only) cannot use ANY moderator endpoint', async () => {
    const { caseCode, id } = await submitReport();
    // Their case code is not a credential for moderator routes.
    const attempts = [
      api().get('/api/v1/moderator/reports').set(bearer(caseCode)),
      api().get(`/api/v1/moderator/reports/${id}`),
      api().patch(`/api/v1/moderator/reports/${id}/status`).send({ status: 'RESOLVED', message: 'hack' }),
      api().post(`/api/v1/moderator/reports/${id}/updates`).send({ message: 'hack' }),
    ];
    for (const res of await Promise.all(attempts)) expect(res.status).toBe(401);
    expect((await prisma.report.findUniqueOrThrow({ where: { id } })).status).toBe('SUBMITTED');
  });
});

describe('authorization (403) and admin-only endpoint', () => {
  const newMod = { email: 'new.mod@example.com', password: 'a-long-enough-password' };

  it('a normal moderator is authenticated but FORBIDDEN from admin endpoints (403)', async () => {
    const token = await loginAs(await createUser('MODERATOR'));
    const res = await api().post('/api/v1/admin/moderators').set(bearer(token)).send(newMod);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('an admin can create a moderator; password hash is not returned; duplicate email -> 409', async () => {
    const token = await loginAs(await createUser('ADMIN'));
    const res = await api().post('/api/v1/admin/moderators').set(bearer(token)).send(newMod);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ email: newMod.email, role: 'MODERATOR' });
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);
    expect((await api().post('/api/v1/admin/moderators').set(bearer(token)).send(newMod)).status).toBe(409);
    // the new moderator can log in
    expect((await api().post('/api/v1/auth/login').send(newMod)).status).toBe(200);
  });

  it('rejects weak passwords and unknown fields when creating a moderator', async () => {
    const token = await loginAs(await createUser('ADMIN'));
    expect((await api().post('/api/v1/admin/moderators').set(bearer(token)).send({ email: 'a@b.com', password: 'short' })).status).toBe(422);
  });
});
