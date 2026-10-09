/**
 * OpenAPI 3.0 description of the API, served by Swagger UI at /api/docs.
 * It is kept as plain TypeScript data (not comments inside route files) so the
 * route files stay clean.
 */
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const resp = (name: string) => ({ $ref: `#/components/responses/${name}` });
const json = (schema: object, example?: unknown) => ({
  'application/json': { schema, ...(example ? { example } : {}) },
});
const wrap = (dataSchema: object) => ({
  type: 'object',
  properties: { success: { type: 'boolean', example: true }, data: dataSchema },
});
const idParam = {
  name: 'id', in: 'path', required: true, description: 'Report UUID (internal id, visible to moderators only)',
  schema: { type: 'string', format: 'uuid' },
};
const secured = [{ bearerAuth: [] }];
const categories = ['SECURITY', 'HARASSMENT', 'CORRUPTION', 'TECHNICAL', 'OTHER'];
const statuses = ['SUBMITTED', 'UNDER_REVIEW', 'RESOLVED', 'DISMISSED'];

export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'WhistleDrop API',
    version: '1.0.0',
    description:
      'Anonymous reporting backend. Reporters never create accounts or provide identity data; they track a report with a secret **case code**. ' +
      'Moderators log in (JWT) and review reports but can never see who submitted them.\n\n' +
      '**Try it:** call `POST /auth/login`, copy the token, click **Authorize** and paste it.',
  },
  tags: [
    { name: 'Public', description: 'No authentication. Used by anonymous reporters.' },
    { name: 'Auth', description: 'Moderator login.' },
    { name: 'Moderator', description: 'Requires a moderator/admin JWT.' },
    { name: 'Admin', description: 'Requires an ADMIN JWT.' },
  ],
  paths: {
    '/api/v1/reports': {
      post: {
        tags: ['Public'], summary: 'Submit an anonymous report',
        description: 'No account or identity needed. Unknown fields (e.g. name, email) are rejected. Returns the case code ONCE; it is stored only as a hash. Rate limited per IP.',
        requestBody: { required: true, content: json(ref('CreateReportRequest'), { category: 'SECURITY', description: 'The staging server admin panel is exposed to the internet without a password.', referenceUrl: 'https://example.com/screenshot' }) },
        responses: {
          201: { description: 'Report created', content: json(wrap(ref('ReportCreated'))) },
          400: resp('InvalidJson'), 422: resp('ValidationError'), 429: resp('RateLimited'),
        },
      },
    },
    '/api/v1/cases/{caseCode}': {
      get: {
        tags: ['Public'], summary: 'Check a report using its case code',
        description: 'Returns status and moderator updates only. A malformed code gives 400; a well-formed but unknown code gives 404 (same response for "wrong" and "never existed"). Only FAILED lookups count towards the rate limit.',
        parameters: [{ name: 'caseCode', in: 'path', required: true, description: 'Case code, e.g. WD-7K2M-9QXD-4TNB-0H8J-WE3C-5RVA (case-insensitive)', schema: { type: 'string' } }],
        responses: {
          200: { description: 'Case found', content: json(wrap(ref('CaseStatus'))) },
          400: { description: 'Malformed case code', content: json(ref('Error')) },
          404: resp('CaseNotFound'), 429: resp('RateLimited'),
        },
      },
    },
    '/api/v1/auth/login': {
      post: {
        tags: ['Auth'], summary: 'Moderator login',
        description: 'Returns a short-lived JWT. Same error for unknown email and wrong password. Only failed attempts count towards the rate limit.',
        requestBody: { required: true, content: json(ref('LoginRequest')) },
        responses: {
          200: { description: 'Logged in', content: json(wrap(ref('LoginResult'))) },
          401: { description: 'Invalid email or password', content: json(ref('Error')) },
          422: resp('ValidationError'), 429: resp('RateLimited'),
        },
      },
    },
    '/api/v1/moderator/reports': {
      get: {
        tags: ['Moderator'], summary: 'List reports (filter by category/status, paginated)', security: secured,
        parameters: [
          { name: 'category', in: 'query', schema: { type: 'string', enum: categories } },
          { name: 'status', in: 'query', schema: { type: 'string', enum: statuses } },
          { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
        ],
        responses: {
          200: { description: 'Page of reports (newest first)', content: json({ type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'array', items: ref('ReportSummary') }, meta: ref('PageMeta') } }) },
          401: resp('Unauthorized'), 403: resp('Forbidden'), 422: resp('ValidationError'),
        },
      },
    },
    '/api/v1/moderator/reports/{id}': {
      get: {
        tags: ['Moderator'], summary: 'View one report with its full update history', security: secured,
        parameters: [idParam],
        responses: {
          200: { description: 'Report', content: json(wrap(ref('ReportDetail'))) },
          400: { description: 'Malformed id', content: json(ref('Error')) },
          401: resp('Unauthorized'), 403: resp('Forbidden'), 404: resp('ReportNotFound'),
        },
      },
    },
    '/api/v1/moderator/reports/{id}/status': {
      patch: {
        tags: ['Moderator'], summary: 'Change report status (validated workflow)', security: secured,
        description: 'Allowed: SUBMITTED→UNDER_REVIEW, UNDER_REVIEW→RESOLVED, UNDER_REVIEW→DISMISSED. Everything else returns 409. RESOLVED and DISMISSED are final. A short message is required and is shown to the reporter.',
        parameters: [idParam],
        requestBody: { required: true, content: json(ref('ChangeStatusRequest'), { status: 'UNDER_REVIEW', message: 'We have started investigating.' }) },
        responses: {
          200: { description: 'Status changed', content: json(wrap(ref('ReportDetail'))) },
          400: { description: 'Malformed id / invalid JSON', content: json(ref('Error')) },
          401: resp('Unauthorized'), 403: resp('Forbidden'), 404: resp('ReportNotFound'),
          409: { description: 'Invalid status transition (or concurrent change)', content: json(ref('Error'), { success: false, error: { code: 'INVALID_STATUS_TRANSITION', message: 'Cannot change status from RESOLVED to SUBMITTED: RESOLVED is a final status.', details: { currentStatus: 'RESOLVED', requestedStatus: 'SUBMITTED', allowedNextStatuses: [] } } }) },
          422: resp('ValidationError'),
        },
      },
    },
    '/api/v1/moderator/reports/{id}/updates': {
      post: {
        tags: ['Moderator'], summary: 'Add a status update (note) without changing status', security: secured,
        description: 'The message is visible to the reporter. Not allowed on closed (RESOLVED/DISMISSED) cases.',
        parameters: [idParam],
        requestBody: { required: true, content: json(ref('AddUpdateRequest')) },
        responses: {
          201: { description: 'Update added', content: json(wrap(ref('StatusUpdate'))) },
          400: { description: 'Malformed id / invalid JSON', content: json(ref('Error')) },
          401: resp('Unauthorized'), 403: resp('Forbidden'), 404: resp('ReportNotFound'),
          409: { description: 'Case is closed', content: json(ref('Error')) },
          422: resp('ValidationError'),
        },
      },
    },
    '/api/v1/admin/moderators': {
      post: {
        tags: ['Admin'], summary: 'Create a moderator account (ADMIN only)', security: secured,
        requestBody: { required: true, content: json(ref('CreateModeratorRequest')) },
        responses: {
          201: { description: 'Created (password hash is never returned)', content: json(wrap(ref('ModeratorAccount'))) },
          401: resp('Unauthorized'), 403: resp('Forbidden'),
          409: { description: 'Email already used', content: json(ref('Error')) },
          422: resp('ValidationError'),
        },
      },
    },
  },
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    responses: {
      Unauthorized: { description: 'Missing, invalid or expired token', content: json(ref('Error'), { success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }) },
      Forbidden: { description: 'Authenticated but not allowed', content: json(ref('Error'), { success: false, error: { code: 'FORBIDDEN', message: 'You do not have permission to perform this action' } }) },
      ValidationError: { description: 'Body/query failed validation', content: json(ref('Error'), { success: false, error: { code: 'VALIDATION_ERROR', message: 'Request validation failed', details: [{ field: 'category', message: 'category must be one of: SECURITY, HARASSMENT, CORRUPTION, TECHNICAL, OTHER' }] } }) },
      InvalidJson: { description: 'Body is not valid JSON', content: json(ref('Error')) },
      RateLimited: { description: 'Too many requests', content: json(ref('Error'), { success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests, please try again later.' } }) },
      CaseNotFound: { description: 'No case for this code', content: json(ref('Error'), { success: false, error: { code: 'CASE_NOT_FOUND', message: 'No case found for this case code' } }) },
      ReportNotFound: { description: 'No report with this id', content: json(ref('Error'), { success: false, error: { code: 'REPORT_NOT_FOUND', message: 'Report not found' } }) },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' }, details: {} } },
        },
      },
      CreateReportRequest: {
        type: 'object', required: ['category', 'description'], additionalProperties: false,
        properties: {
          category: { type: 'string', enum: categories },
          description: { type: 'string', minLength: 20, maxLength: 5000 },
          referenceUrl: { type: 'string', format: 'uri', maxLength: 2048, description: 'Optional http(s) link to evidence' },
        },
      },
      ReportCreated: {
        type: 'object',
        properties: {
          caseCode: { type: 'string', example: 'WD-7K2M-9QXD-4TNB-0H8J-WE3C-5RVA' },
          category: { type: 'string', enum: categories }, status: { type: 'string', enum: statuses },
          submittedAt: { type: 'string', format: 'date-time' }, notice: { type: 'string' },
        },
      },
      CaseStatus: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: categories }, status: { type: 'string', enum: statuses },
          submittedAt: { type: 'string', format: 'date-time' }, lastUpdatedAt: { type: 'string', format: 'date-time' },
          updates: { type: 'array', items: { type: 'object', properties: { message: { type: 'string' }, statusChangedTo: { type: 'string', nullable: true, enum: statuses }, createdAt: { type: 'string', format: 'date-time' } } } },
        },
      },
      LoginRequest: { type: 'object', required: ['email', 'password'], properties: { email: { type: 'string', format: 'email' }, password: { type: 'string' } } },
      LoginResult: {
        type: 'object',
        properties: { token: { type: 'string' }, tokenType: { type: 'string', example: 'Bearer' }, expiresIn: { type: 'string', example: '1h' }, moderator: ref('ModeratorAccount') },
      },
      ModeratorAccount: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, email: { type: 'string' }, role: { type: 'string', enum: ['MODERATOR', 'ADMIN'] } } },
      CreateModeratorRequest: { type: 'object', required: ['email', 'password'], properties: { email: { type: 'string', format: 'email' }, password: { type: 'string', minLength: 12, maxLength: 72 }, role: { type: 'string', enum: ['MODERATOR', 'ADMIN'], default: 'MODERATOR' } } },
      ReportSummary: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' }, category: { type: 'string', enum: categories }, status: { type: 'string', enum: statuses }, descriptionPreview: { type: 'string' }, createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' } },
      },
      ReportDetail: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' }, category: { type: 'string', enum: categories }, description: { type: 'string' },
          referenceUrl: { type: 'string', nullable: true }, status: { type: 'string', enum: statuses },
          createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' },
          updates: { type: 'array', items: ref('StatusUpdate') },
        },
      },
      StatusUpdate: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' }, moderatorId: { type: 'string', format: 'uuid' }, fromStatus: { type: 'string', nullable: true }, toStatus: { type: 'string', nullable: true }, message: { type: 'string' }, createdAt: { type: 'string', format: 'date-time' } },
      },
      ChangeStatusRequest: { type: 'object', required: ['status', 'message'], properties: { status: { type: 'string', enum: statuses }, message: { type: 'string', maxLength: 500 } } },
      AddUpdateRequest: { type: 'object', required: ['message'], properties: { message: { type: 'string', maxLength: 500 } } },
      PageMeta: { type: 'object', properties: { page: { type: 'integer' }, limit: { type: 'integer' }, total: { type: 'integer' }, totalPages: { type: 'integer' } } },
    },
  },
};
