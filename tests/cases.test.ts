import { api, bearer, moderatorToken, prisma, resetDb, submitReport } from './helpers';

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe('GET /api/v1/cases/:caseCode (reporter tracking)', () => {
  it('returns status and updates for a valid case code, with no auth', async () => {
    const { caseCode } = await submitReport();
    const res = await api().get(`/api/v1/cases/${caseCode}`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('SUBMITTED');
    expect(res.body.data.updates).toEqual([]);
  });

  it('exposes ONLY safe fields: no id, no description, no moderator information', async () => {
    const { caseCode } = await submitReport();
    const res = await api().get(`/api/v1/cases/${caseCode}`);
    expect(Object.keys(res.body.data).sort()).toEqual(['category', 'lastUpdatedAt', 'status', 'submittedAt', 'updates']);
  });

  it('accepts the code in lower case', async () => {
    const { caseCode } = await submitReport();
    const res = await api().get(`/api/v1/cases/${caseCode.toLowerCase()}`);
    expect(res.status).toBe(200);
  });

  it('returns each reporter only their own report', async () => {
    const a = await submitReport({ category: 'HARASSMENT' });
    const b = await submitReport({ category: 'CORRUPTION' });
    expect((await api().get(`/api/v1/cases/${a.caseCode}`)).body.data.category).toBe('HARASSMENT');
    expect((await api().get(`/api/v1/cases/${b.caseCode}`)).body.data.category).toBe('CORRUPTION');
  });

  it('malformed case code -> 400', async () => {
    const res = await api().get('/api/v1/cases/hello');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_PARAMETER');
  });

  it('well-formed but unknown case code -> 404, identical for every unknown code and without echoing it', async () => {
    const r1 = await api().get('/api/v1/cases/WD-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA');
    const r2 = await api().get('/api/v1/cases/WD-BBBB-BBBB-BBBB-BBBB-BBBB-BBBB');
    expect(r1.status).toBe(404);
    expect(r1.body).toEqual(r2.body);
    expect(JSON.stringify(r1.body)).not.toContain('AAAA');
    expect(r1.body.error.code).toBe('CASE_NOT_FOUND');
  });

  it('shows the reporter moderator updates, but not who wrote them', async () => {
    const { caseCode, id } = await submitReport();
    const token = await moderatorToken();
    await api().patch(`/api/v1/moderator/reports/${id}/status`).set(bearer(token))
      .send({ status: 'UNDER_REVIEW', message: 'We are looking into this.' });

    const res = await api().get(`/api/v1/cases/${caseCode}`);
    expect(res.body.data.status).toBe('UNDER_REVIEW');
    expect(res.body.data.updates).toHaveLength(1);
    expect(res.body.data.updates[0]).toMatchObject({ message: 'We are looking into this.', statusChangedTo: 'UNDER_REVIEW' });
    expect(res.body.data.updates[0]).not.toHaveProperty('moderatorId');
  });
});
