import { api, bearer, moderatorToken, prisma, resetDb, submitReport } from './helpers';

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const url = (id: string, tail = '') => `/api/v1/moderator/reports/${id}${tail}`;

describe('viewing and filtering reports', () => {
  it('lists reports for an authorized moderator, without any reporter-identifying data', async () => {
    await submitReport();
    const token = await moderatorToken();
    const res = await api().get('/api/v1/moderator/reports').set(bearer(token));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(Object.keys(res.body.data[0]).sort()).toEqual(['category', 'createdAt', 'descriptionPreview', 'id', 'status', 'updatedAt']);
    expect(JSON.stringify(res.body)).not.toMatch(/WD-|caseCode|caseCodeHash|case_code/);
    expect(res.body.meta).toMatchObject({ page: 1, total: 1 });
  });

  it('filters by category', async () => {
    await submitReport({ category: 'SECURITY' });
    await submitReport({ category: 'HARASSMENT' });
    await submitReport({ category: 'HARASSMENT' });
    const token = await moderatorToken();
    const res = await api().get('/api/v1/moderator/reports?category=HARASSMENT').set(bearer(token));
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data.every((r: { category: string }) => r.category === 'HARASSMENT')).toBe(true);
  });

  it('filters by status (and by category + status together)', async () => {
    const a = await submitReport({ category: 'SECURITY' });
    await submitReport({ category: 'TECHNICAL' });
    const token = await moderatorToken();
    await api().patch(url(a.id, '/status')).set(bearer(token)).send({ status: 'UNDER_REVIEW', message: 'Looking' });

    const review = await api().get('/api/v1/moderator/reports?status=UNDER_REVIEW').set(bearer(token));
    expect(review.body.data).toHaveLength(1);
    expect(review.body.data[0].id).toBe(a.id);

    const none = await api().get('/api/v1/moderator/reports?status=UNDER_REVIEW&category=TECHNICAL').set(bearer(token));
    expect(none.body.data).toHaveLength(0);
  });

  it('rejects invalid filters (422) and paginates', async () => {
    for (let i = 0; i < 3; i++) await submitReport();
    const token = await moderatorToken();
    expect((await api().get('/api/v1/moderator/reports?category=NOPE').set(bearer(token))).status).toBe(422);
    expect((await api().get('/api/v1/moderator/reports?limit=1000').set(bearer(token))).status).toBe(422);
    const page = await api().get('/api/v1/moderator/reports?limit=2&page=2').set(bearer(token));
    expect(page.body.data).toHaveLength(1);
    expect(page.body.meta).toMatchObject({ total: 3, totalPages: 2 });
  });

  it('shows one report in full; unknown id -> 404; malformed id -> 400', async () => {
    const { id } = await submitReport({ referenceUrl: 'https://example.com/e' });
    const token = await moderatorToken();
    const ok = await api().get(url(id)).set(bearer(token));
    expect(ok.status).toBe(200);
    expect(ok.body.data.referenceUrl).toBe('https://example.com/e');
    expect(ok.body.data.description).toContain('staging server');
    expect((await api().get(url('11111111-1111-4111-8111-111111111111')).set(bearer(token))).status).toBe(404);
    expect((await api().get(url('not-a-uuid')).set(bearer(token))).status).toBe(400);
  });
});

describe('status workflow SUBMITTED -> UNDER_REVIEW -> RESOLVED/DISMISSED', () => {
  const move = (token: string, id: string, status: string) =>
    api().patch(url(id, '/status')).set(bearer(token)).send({ status, message: `moving to ${status}` });

  it('allows the valid path and records who/when/from/to', async () => {
    const { id } = await submitReport();
    const token = await moderatorToken();
    expect((await move(token, id, 'UNDER_REVIEW')).status).toBe(200);
    const res = await move(token, id, 'RESOLVED');
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('RESOLVED');
    expect(res.body.data.updates.map((u: { fromStatus: string; toStatus: string }) => [u.fromStatus, u.toStatus]))
      .toEqual([['SUBMITTED', 'UNDER_REVIEW'], ['UNDER_REVIEW', 'RESOLVED']]);
  });

  it('UNDER_REVIEW can also go to DISMISSED', async () => {
    const { id } = await submitReport();
    const token = await moderatorToken();
    await move(token, id, 'UNDER_REVIEW');
    expect((await move(token, id, 'DISMISSED')).body.data.status).toBe('DISMISSED');
  });

  it('RESOLVED -> SUBMITTED is rejected with 409 and an explanation; status is unchanged', async () => {
    const { id } = await submitReport();
    const token = await moderatorToken();
    await move(token, id, 'UNDER_REVIEW');
    await move(token, id, 'RESOLVED');
    const res = await move(token, id, 'SUBMITTED');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_STATUS_TRANSITION');
    expect(res.body.error.message).toContain('final status');
    expect(res.body.error.details.allowedNextStatuses).toEqual([]);
    expect((await prisma.report.findUniqueOrThrow({ where: { id } })).status).toBe('RESOLVED');
  });

  it('skipping a step (SUBMITTED -> RESOLVED) and no-op (UNDER_REVIEW -> UNDER_REVIEW) are rejected', async () => {
    const { id } = await submitReport();
    const token = await moderatorToken();
    expect((await move(token, id, 'RESOLVED')).status).toBe(409);
    await move(token, id, 'UNDER_REVIEW');
    expect((await move(token, id, 'UNDER_REVIEW')).status).toBe(409);
    expect((await move(token, id, 'SUBMITTED')).status).toBe(409);
  });

  it('rejects an unknown status or missing message (422) and unknown report (404)', async () => {
    const { id } = await submitReport();
    const token = await moderatorToken();
    expect((await move(token, id, 'DONE')).status).toBe(422);
    expect((await api().patch(url(id, '/status')).set(bearer(token)).send({ status: 'UNDER_REVIEW' })).status).toBe(422);
    expect((await move(token, '11111111-1111-4111-8111-111111111111', 'UNDER_REVIEW')).status).toBe(404);
  });

  it('two moderators racing to close the same report: exactly one wins (no lost update)', async () => {
    const { id } = await submitReport();
    const t1 = await moderatorToken();
    const t2 = await moderatorToken();
    await move(t1, id, 'UNDER_REVIEW');
    const [a, b] = await Promise.all([move(t1, id, 'RESOLVED'), move(t2, id, 'DISMISSED')]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await prisma.statusUpdate.count({ where: { reportId: id } })).toBe(2); // review + exactly one close
  });
});

describe('POST /moderator/reports/:id/updates (status updates / notes)', () => {
  it('adds a note without changing the status, and the reporter can see it', async () => {
    const { id, caseCode } = await submitReport();
    const token = await moderatorToken();
    const res = await api().post(url(id, '/updates')).set(bearer(token)).send({ message: 'Can you tell us which server?' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ fromStatus: null, toStatus: null });

    expect((await prisma.report.findUniqueOrThrow({ where: { id } })).status).toBe('SUBMITTED');
    const tracked = await api().get(`/api/v1/cases/${caseCode}`);
    expect(tracked.body.data.updates[0].message).toBe('Can you tell us which server?');
  });

  it('validates the message (422) and refuses notes on closed cases (409)', async () => {
    const { id } = await submitReport();
    const token = await moderatorToken();
    expect((await api().post(url(id, '/updates')).set(bearer(token)).send({})).status).toBe(422);
    expect((await api().post(url(id, '/updates')).set(bearer(token)).send({ message: 'x'.repeat(501) })).status).toBe(422);

    await api().patch(url(id, '/status')).set(bearer(token)).send({ status: 'UNDER_REVIEW', message: 'a' });
    await api().patch(url(id, '/status')).set(bearer(token)).send({ status: 'DISMISSED', message: 'b' });
    const closed = await api().post(url(id, '/updates')).set(bearer(token)).send({ message: 'late note' });
    expect(closed.status).toBe(409);
    expect(closed.body.error.code).toBe('CASE_CLOSED');
  });
});
