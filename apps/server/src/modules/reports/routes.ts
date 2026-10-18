// SPDX-License-Identifier: Apache-2.0
import {
  gradeRequestSchema,
  gradingQueueSchema,
  itemReportSchema,
  libraryItemIdSchema,
  okSchema,
} from '@coursecraft/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { requireAuth } from '../../auth/plugin.js';
import type { AppContext } from '../../http/context.js';
import { writeXlsx } from '../../lib/xlsx.js';
import { grade, gradingQueue, itemReport, reportCsv, reportTable } from './service.js';

export function reportRoutes(app: FastifyInstance, ctx: AppContext): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/api/reports/items/:id',
    {
      config: { permission: 'reports.read' },
      schema: { params: libraryItemIdSchema, response: { 200: itemReportSchema } },
    },
    async (request) => itemReport(ctx, requireAuth(request), request.params.id),
  );

  r.get(
    '/api/reports/items/:id/csv',
    { config: { permission: 'reports.read' }, schema: { params: libraryItemIdSchema } },
    async (request, reply) => {
      const auth = requireAuth(request);
      const report = await itemReport(ctx, auth, request.params.id);
      await ctx.audit.record({
        actorUserId: auth.userId,
        action: 'report.exported',
        targetType: 'library_item',
        targetId: request.params.id,
      });
      return reply
        .type('text/csv; charset=utf-8')
        .header('Content-Disposition', 'attachment; filename="report.csv"')
        .header('Cache-Control', 'no-store')
        .send(reportCsv(report.rows));
    },
  );

  r.get(
    '/api/reports/items/:id/xlsx',
    { config: { permission: 'reports.read' }, schema: { params: libraryItemIdSchema } },
    async (request, reply) => {
      const auth = requireAuth(request);
      const report = await itemReport(ctx, auth, request.params.id);
      await ctx.audit.record({
        actorUserId: auth.userId,
        action: 'report.exported',
        targetType: 'library_item',
        targetId: request.params.id,
        meta: { format: 'xlsx' },
      });
      const { header, cells } = reportTable(report.rows);
      return reply
        .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('Content-Disposition', 'attachment; filename="report.xlsx"')
        .header('Cache-Control', 'no-store')
        .send(await writeXlsx(report.item.title, header, cells));
    },
  );

  r.get(
    '/api/grading',
    { config: { permission: 'grading.perform' }, schema: { response: { 200: gradingQueueSchema } } },
    async (request) => ({ items: await gradingQueue(ctx, requireAuth(request)) }),
  );

  r.post(
    '/api/grading',
    {
      config: { permission: 'grading.perform' },
      schema: { body: gradeRequestSchema, response: { 200: okSchema } },
    },
    async (request) => {
      await grade(ctx, requireAuth(request), request.body);
      return { ok: true as const };
    },
  );
}
