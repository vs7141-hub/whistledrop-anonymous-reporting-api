import { api, prisma, resetDb, validReport } from './helpers';
import { CASE_CODE_REGEX, hashCaseCode } from '../src/utils/caseCode';

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe('POST /api/v1/reports (anonymous reporting)', () => {
  it('creates a report with NO authentication and returns a case code (201)', async () => {
    const res = await api().post('/api/v1/reports').send({ ...validReport, referenceUrl: 'https://example.com/proof' });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.caseCode).toMatch(CASE_CODE_REGEX);
    expect(res.body.data.status).toBe('SUBMITTED');
    // The reporter gets nothing that could link back to the stored row.
    expect(res.body.data).not.toHaveProperty('id');
    expect(await prisma.report.count()).toBe(1);
  });

  it('rejects a body with missing required fields (422, field-level details)', async () => {
    const res = await api().post('/api/v1/reports').send({ category: 'SECURITY' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d: { field: string }) => d.field)).toContain('description');
    expect(await prisma.report.count()).toBe(0);
  });

  it('rejects an empty body', async () => {
    const res = await api().post('/api/v1/reports').send({});
    expect(res.status).toBe(422);
  });

  it('rejects an invalid category', async () => {
    const res = await api().post('/api/v1/reports').send({ ...validReport, category: 'GOSSIP' });
    expect(res.status).toBe(422);
    expect(res.body.error.details[0].field).toBe('category');
  });

  it.each(['not a url', 'javascript:alert(1)', 'ftp://example.com/file'])('rejects invalid reference URL %p', async (referenceUrl) => {
    const res = await api().post('/api/v1/reports').send({ ...validReport, referenceUrl });
    expect(res.status).toBe(422);
    expect(res.body.error.details[0].field).toBe('referenceUrl');
  });

  it('rejects too-short and too-long descriptions', async () => {
    expect((await api().post('/api/v1/reports').send({ ...validReport, description: 'too short' })).status).toBe(422);
    expect((await api().post('/api/v1/reports').send({ ...validReport, description: 'x'.repeat(5001) })).status).toBe(422);
  });

  it('REFUSES identity fields instead of silently storing or ignoring them', async () => {
    for (const extra of [{ email: 'me@x.com' }, { name: 'Alice' }, { phone: '123' }, { studentId: 'RA2411' }]) {
      const res = await api().post('/api/v1/reports').send({ ...validReport, ...extra });
      expect(res.status).toBe(422);
    }
    expect(await prisma.report.count()).toBe(0);
  });
});

describe('privacy of stored data', () => {
  it('the reports table has no identity columns at all', async () => {
    const cols = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name::text AS column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'reports'`;
    expect(cols.map((c) => c.column_name).sort()).toEqual(
      ['case_code_hash', 'category', 'created_at', 'description', 'id', 'reference_url', 'status', 'updated_at'],
    );
  });

  it('stores only a hash of the case code, never the code itself', async () => {
    const res = await api().post('/api/v1/reports').send(validReport);
    const { caseCode } = res.body.data;
    const row = await prisma.report.findFirstOrThrow();
    expect(row.caseCodeHash).toBe(hashCaseCode(caseCode));
    expect(row.caseCodeHash).toHaveLength(64);
    expect(JSON.stringify(row)).not.toContain(caseCode);
  });
});
