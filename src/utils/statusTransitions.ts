import { ReportStatus } from '../generated/prisma/enums';

/**
 * The status workflow as DATA (a state machine):
 *
 *   SUBMITTED -> UNDER_REVIEW -> RESOLVED
 *                            \-> DISMISSED
 *
 * RESOLVED and DISMISSED are final. Nothing may leave them (no re-opening).
 * Adding a rule later = editing this one table.
 */
export const ALLOWED_TRANSITIONS: Record<ReportStatus, ReportStatus[]> = {
  SUBMITTED: ['UNDER_REVIEW'],
  UNDER_REVIEW: ['RESOLVED', 'DISMISSED'],
  RESOLVED: [],
  DISMISSED: [],
};

export const canTransition = (from: ReportStatus, to: ReportStatus) =>
  ALLOWED_TRANSITIONS[from].includes(to);

export const isFinalStatus = (status: ReportStatus) => ALLOWED_TRANSITIONS[status].length === 0;
