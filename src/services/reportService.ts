import { prisma } from '../lib/prisma';
import { Prisma } from '../generated/prisma/client';
import { ReportStatus } from '../generated/prisma/enums';
import { generateCaseCode, hashCaseCode } from '../utils/caseCode';
import { canTransition, isFinalStatus, ALLOWED_TRANSITIONS } from '../utils/statusTransitions';
import { conflict, notFound } from '../utils/errors';
import { ChangeStatusInput, CreateReportInput, ListReportsQuery } from '../schemas';

// ---------- Reporter side -------------------------------------------------

export async function createReport(input: CreateReportInput) {
  // A unique-constraint collision on a 120-bit random value is essentially
  // impossible, but handling it correctly costs 5 lines.
  for (let attempt = 0; attempt < 3; attempt++) {
    const caseCode = generateCaseCode();
    try {
      const report = await prisma.report.create({
        data: {
          caseCodeHash: hashCaseCode(caseCode), // only the hash is stored
          category: input.category,
          description: input.description,
          referenceUrl: input.referenceUrl,
        },
        select: { category: true, status: true, createdAt: true },
      });
      return { caseCode, ...report };
    } catch (err) {
      const isCollision = err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
      if (!isCollision) throw err;
    }
  }
  throw new Error('Could not generate a unique case code');
}

/** What a reporter may see: status + moderator messages. Never the description, ids or authors. */
export async function getCaseForReporter(caseCode: string) {
  const report = await prisma.report.findUnique({
    where: { caseCodeHash: hashCaseCode(caseCode) },
    select: {
      category: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      updates: {
        orderBy: { createdAt: 'asc' },
        select: { toStatus: true, message: true, createdAt: true },
      },
    },
  });
  // Wrong code and non-existent code look identical on purpose.
  if (!report) throw notFound('CASE_NOT_FOUND', 'No case found for this case code');

  return {
    category: report.category,
    status: report.status,
    submittedAt: report.createdAt,
    lastUpdatedAt: report.updatedAt,
    updates: report.updates.map((u) => ({
      message: u.message,
      statusChangedTo: u.toStatus, // null when the update was a plain note
      createdAt: u.createdAt,
    })),
  };
}

// ---------- Moderator side ------------------------------------------------

const PREVIEW_LENGTH = 150;

export async function listReports(query: ListReportsQuery) {
  const where: Prisma.ReportWhereInput = {
    ...(query.category ? { category: query.category } : {}),
    ...(query.status ? { status: query.status } : {}),
  };
  const [total, rows] = await prisma.$transaction([
    prisma.report.count({ where }),
    prisma.report.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      select: { id: true, category: true, status: true, description: true, createdAt: true, updatedAt: true },
    }),
  ]);

  const items = rows.map(({ description, ...r }) => ({
    ...r,
    descriptionPreview:
      description.length > PREVIEW_LENGTH ? description.slice(0, PREVIEW_LENGTH) + '…' : description,
  }));
  return {
    items,
    meta: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) },
  };
}

const detailSelect = {
  id: true,
  category: true,
  description: true,
  referenceUrl: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  updates: {
    orderBy: { createdAt: 'asc' as const },
    select: { id: true, moderatorId: true, fromStatus: true, toStatus: true, message: true, createdAt: true },
  },
} satisfies Prisma.ReportSelect;

export async function getReportById(id: string) {
  const report = await prisma.report.findUnique({ where: { id }, select: detailSelect });
  if (!report) throw notFound('REPORT_NOT_FOUND', 'Report not found');
  return report;
}

export async function changeStatus(reportId: string, moderatorId: string, input: ChangeStatusInput) {
  await prisma.$transaction(async (tx) => {
    const report = await tx.report.findUnique({ where: { id: reportId }, select: { status: true } });
    if (!report) throw notFound('REPORT_NOT_FOUND', 'Report not found');

    if (!canTransition(report.status, input.status)) {
      const allowed = ALLOWED_TRANSITIONS[report.status];
      throw conflict(
        'INVALID_STATUS_TRANSITION',
        isFinalStatus(report.status)
          ? `Cannot change status from ${report.status} to ${input.status}: ${report.status} is a final status.`
          : `Cannot change status from ${report.status} to ${input.status}.`,
        { currentStatus: report.status, requestedStatus: input.status, allowedNextStatuses: allowed },
      );
    }

    // "Compare-and-set": only update if the status is STILL what we just read.
    // If two moderators click at the same moment, exactly one of them wins.
    const result = await tx.report.updateMany({
      where: { id: reportId, status: report.status },
      data: { status: input.status },
    });
    if (result.count === 0) {
      throw conflict('STATUS_CHANGED_CONCURRENTLY', 'The report status was changed by someone else. Reload and try again.');
    }

    await tx.statusUpdate.create({
      data: { reportId, moderatorId, fromStatus: report.status, toStatus: input.status, message: input.message },
    });
  });
  return getReportById(reportId);
}

export async function addUpdate(reportId: string, moderatorId: string, message: string) {
  const report = await prisma.report.findUnique({ where: { id: reportId }, select: { status: true } });
  if (!report) throw notFound('REPORT_NOT_FOUND', 'Report not found');
  // Closed cases are permanently closed (see README: "Permanently closed cases").
  if (isFinalStatus(report.status)) {
    throw conflict('CASE_CLOSED', `This case is ${report.status} and permanently closed; no more updates can be added.`);
  }
  return prisma.statusUpdate.create({
    data: { reportId, moderatorId, message },
    select: { id: true, moderatorId: true, fromStatus: true, toStatus: true, message: true, createdAt: true },
  });
}
