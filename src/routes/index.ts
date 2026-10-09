import { Router } from 'express';
import * as reports from '../controllers/reportController';
import * as auth from '../controllers/authController';
import { asyncHandler } from '../utils/asyncHandler';
import { validate } from '../middleware/validate';
import { authenticate, authorize } from '../middleware/auth';
import { caseLookupLimiter, loginLimiter, reportCreateLimiter } from '../middleware/rateLimiters';
import {
  addUpdateSchema, caseCodeParamsSchema, changeStatusSchema, createModeratorSchema, createReportSchema,
  listReportsQuerySchema, loginSchema, reportIdParamsSchema,
} from '../schemas';

/**
 * Routes only DECLARE: URL + middleware chain + controller. No business logic.
 * Three areas, so the security boundary is visible in the URL itself:
 *   /reports, /cases   public (anonymous reporters)
 *   /auth              login
 *   /moderator/*       JWT required (one router.use protects everything below)
 *   /admin/*           JWT + ADMIN role
 */
const api = Router();

// ----- Public -----
api.post('/reports', reportCreateLimiter, validate({ body: createReportSchema }), asyncHandler(reports.createReport));
api.get('/cases/:caseCode', caseLookupLimiter, validate({ params: caseCodeParamsSchema }), asyncHandler(reports.getCase));

// ----- Auth -----
api.post('/auth/login', loginLimiter, validate({ body: loginSchema }), asyncHandler(auth.login));

// ----- Moderator (MODERATOR or ADMIN) -----
const moderator = Router();
moderator.use(authenticate, authorize('MODERATOR', 'ADMIN'));
moderator.get('/reports', validate({ query: listReportsQuerySchema }), asyncHandler(reports.listReports));
moderator.get('/reports/:id', validate({ params: reportIdParamsSchema }), asyncHandler(reports.getReport));
moderator.patch('/reports/:id/status', validate({ params: reportIdParamsSchema, body: changeStatusSchema }), asyncHandler(reports.changeStatus));
moderator.post('/reports/:id/updates', validate({ params: reportIdParamsSchema, body: addUpdateSchema }), asyncHandler(reports.addUpdate));
api.use('/moderator', moderator);

// ----- Admin only -----
const admin = Router();
admin.use(authenticate, authorize('ADMIN'));
admin.post('/moderators', validate({ body: createModeratorSchema }), asyncHandler(auth.createModerator));
api.use('/admin', admin);

export default api;
