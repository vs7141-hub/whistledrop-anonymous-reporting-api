import { api, prisma, resetDb, validReport } from './helpers';

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe('security headers & safe errors', () => {
  it('sets Helmet headers, hides X-Powered-By and disables caching', async () => {
    const res = await api().get('/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toBeDefined();
    expect(res.headers['content-security-policy']).toBeDefined();
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('malformed JSON -> 400 INVALID_JSON, with no parser internals', async () => {
    const res = await api().post('/api/v1/reports').set('Content-Type', 'application/json').send('{"category": ');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON' } });
  });

  it('oversized body -> 413', async () => {
    const res = await api().post('/api/v1/reports').send({ ...validReport, description: 'x'.repeat(20000) });
    expect(res.status).toBe(413);
  });

  it('unknown route -> consistent 404 JSON', async () => {
    const res = await api().get('/api/v1/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('an unexpected internal/database error returns a generic 500 and leaks nothing', async () => {
    const spy = jest.spyOn(prisma.report, 'create').mockRejectedValueOnce(
      new Error('connection to server at "10.0.0.5" failed: password authentication failed for user "admin" SECRET_DETAIL'),
    );
    const res = await api().post('/api/v1/reports').send(validReport);
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toMatch(/10\.0\.0\.5|SECRET_DETAIL|password|stack/i);
    spy.mockRestore();
  });

  it('serves the OpenAPI document', async () => {
    const res = await api().get('/api/docs.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toMatch(/^3\./);
    expect(Object.keys(res.body.paths)).toContain('/api/v1/cases/{caseCode}');
  });
});
