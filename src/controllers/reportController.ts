import { Request, Response } from 'express';
import * as reportService from '../services/reportService';
import { sendSuccess } from '../utils/response';
import { AddUpdateInput, ChangeStatusInput, CreateReportInput, ListReportsQuery } from '../schemas';
import { AuthUser } from '../middleware/auth';

// Controllers are thin: take validated input -> call a service -> shape the HTTP response.

export async function createReport(req: Request, res: Response) {
  const { caseCode, category, status, createdAt } = await reportService.createReport(req.body as CreateReportInput);
  return sendSuccess(
    res,
    {
      caseCode,
      category,
      status,
      submittedAt: createdAt,
      notice: 'Save this case code now. It is the ONLY way to check your report and it cannot be recovered.',
    },
    201,
  );
}

export async function getCase(req: Request, res: Response) {
  const data = await reportService.getCaseForReporter(req.params.caseCode as string);
  return sendSuccess(res, data);
}

export async function listReports(req: Request, res: Response) {
  const { items, meta } = await reportService.listReports(req.query as unknown as ListReportsQuery);
  return sendSuccess(res, items, 200, meta);
}

export async function getReport(req: Request, res: Response) {
  return sendSuccess(res, await reportService.getReportById(req.params.id as string));
}

export async function changeStatus(req: Request, res: Response) {
  const user = res.locals.user as AuthUser;
  const data = await reportService.changeStatus(req.params.id as string, user.id, req.body as ChangeStatusInput);
  return sendSuccess(res, data);
}

export async function addUpdate(req: Request, res: Response) {
  const user = res.locals.user as AuthUser;
  const { message } = req.body as AddUpdateInput;
  return sendSuccess(res, await reportService.addUpdate(req.params.id as string, user.id, message), 201);
}
