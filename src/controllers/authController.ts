import { Request, Response } from 'express';
import * as authService from '../services/authService';
import { sendSuccess } from '../utils/response';
import { CreateModeratorInput, LoginInput } from '../schemas';

export async function login(req: Request, res: Response) {
  return sendSuccess(res, await authService.login(req.body as LoginInput));
}

export async function createModerator(req: Request, res: Response) {
  return sendSuccess(res, await authService.createModerator(req.body as CreateModeratorInput), 201);
}
