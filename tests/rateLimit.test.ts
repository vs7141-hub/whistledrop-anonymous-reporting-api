// These limits are read when the app is first imported, so set them BEFORE requiring it.
process.env.LOGIN_FAILED_MAX = '3';
process.env.LOOKUP_FAILED_MAX = '3';
process.env.REPORT_RATE_LIMIT_MAX = '2';

/* eslint-disable @typescript-eslint/no-require-imports */
const { api, prisma, resetDb, validReport, createUser, submitReport } = require('./helpers') as typeof import('./helpers');

beforeAll(resetDb);
afterAll(() => prisma.$disconnect());

describe('rate limiting (429)', () => {
  it('limits report creation per IP', async () => {
    expect((await api().post('/api/v1/reports').send(validReport)).status).toBe(201);
    expect((await api().post('/api/v1/reports').send(validReport)).status).toBe(201);
    const third = await api().post('/api/v1/reports').send(validReport);
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe('RATE_LIMITED');
    expect(third.headers['ratelimit']).toBeDefined();
  });

  it('case-code lookup: correct lookups are free, but repeated WRONG guesses get blocked', async () => {
    // Seed a report directly so we are not throttled by the report limiter above.
    const { prisma: p } = require('./helpers') as typeof import('./helpers');
    const { generateCaseCode, hashCaseCode } = require('../src/utils/caseCode') as typeof import('../src/utils/caseCode');
    const code = generateCaseCode();
    await p.report.create({ data: { caseCodeHash: hashCaseCode(code), category: 'OTHER', description: 'x'.repeat(30) } });

    for (let i = 0; i < 5; i++) expect((await api().get(`/api/v1/cases/${code}`)).status).toBe(200); // successes not counted

    const wrong = 'WD-0000-0000-0000-0000-0000-0000';
    for (let i = 0; i < 3; i++) expect((await api().get(`/api/v1/cases/${wrong}`)).status).toBe(404);
    expect((await api().get(`/api/v1/cases/${wrong}`)).status).toBe(429); // 4th wrong guess is blocked
  });

  it('login: only failed attempts count, and brute force gets blocked', async () => {
    const user = await createUser();
    for (let i = 0; i < 5; i++) {
      expect((await api().post('/api/v1/auth/login').send({ email: user.email, password: user.password })).status).toBe(200);
    }
    for (let i = 0; i < 3; i++) {
      expect((await api().post('/api/v1/auth/login').send({ email: user.email, password: 'wrong-password-1' })).status).toBe(401);
    }
    const blocked = await api().post('/api/v1/auth/login').send({ email: user.email, password: 'wrong-password-1' });
    expect(blocked.status).toBe(429);
  });
});

void submitReport;
