// SPDX-License-Identifier: Apache-2.0
import { publicUrl } from '../../tenancy/origins.js';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { responseSchema } from '@coursecraft/course-model';
import { z } from 'zod';
import type { AppContext } from '../../http/context.js';
import { badRequest, notFound } from '../../http/errors.js';
import { gradeAttempt } from '../learning/grade.js';
import { PackageStore } from '../library/packages.js';
import {
  deleteDocument,
  fetchAuthToken,
  getDocument,
  getStatements,
  resolveLaunch,
  storeStatements,
  writeDocument,
  type DocumentKind,
  type Launch,
} from './service.js';

const tokenParams = z.object({ token: z.string().max(64) });

/** A learner's quiz answers for server-side grading (F-07). */
const gradeSubmissionSchema = z
  .object({
    quizzes: z
      .array(
        z
          .object({
            quizId: z.string().max(200),
            answers: z
              .array(z.object({ questionId: z.string().max(200), response: responseSchema }).strict())
              .max(500),
          })
          .strict(),
      )
      .max(200),
  })
  .strict();
const fileParams = tokenParams.extend({ '*': z.string().max(2000) });
const documentQuery = z.object({
  activityId: z.string().max(2000).optional(),
  agent: z.string().max(4000).optional(),
  registration: z.string().max(100).optional(),
  stateId: z.string().max(500).optional(),
  profileId: z.string().max(500).optional(),
});
const statementQuery = z.object({
  statementId: z.string().max(100).optional(),
  voidedStatementId: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(0).max(500).optional(),
});

const DOCUMENT_PATHS: [string, DocumentKind][] = [
  ['activities/state', 'state'],
  ['activities/profile', 'activity_profile'],
  ['agents/profile', 'agent_profile'],
];

/** CSP for playback: own courses strict, third-party packages as loose as they need, framed only by the app. */
function playbackCsp(kind: string, frameAncestor: string): string {
  const own = kind === 'coursecraft';
  return [
    "default-src 'self'",
    own ? "script-src 'self'" : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    own ? "style-src 'self'" : "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' data: blob:",
    own ? "font-src 'self'" : "font-src 'self' data:",
    "connect-src 'self'",
    "frame-src 'self'",
    "object-src 'none'",
    own ? "base-uri 'none'" : "base-uri 'self'",
    "form-action 'self'",
    `frame-ancestors ${frameAncestor}`,
  ].join('; ');
}

function wrapperHtml(appOrigin: string): string {
  return `<!doctype html>
<html lang="en" data-app-origin="${appOrigin.replace(/[^a-zA-Z0-9:/.\-[\]]/g, '')}">
<head>
<meta charset="utf-8">
<title>Coursecraft</title>
<link rel="stylesheet" href="wrapper.css">
<script src="scorm-again.min.js"></script>
<script src="scorm-wrapper.js"></script>
</head>
<body><iframe id="sco" title="Course"></iframe></body>
</html>
`;
}

const WRAPPER_CSS =
  'html,body{margin:0;height:100%;overflow:hidden}iframe{border:0;width:100%;height:100%;display:block}';

/**
 * Stored documents are bytes chosen by the learner's browser. They are never
 * rendered: the type comes from this list, whatever was stored
 * (SECURITY_AUDIT.md F-12).
 */
const INERT_TYPES = new Set(['application/json', 'text/plain', 'application/octet-stream']);
const inertType = (stored: string): string => {
  const base = stored.split(';')[0]?.trim().toLowerCase() ?? '';
  return INERT_TYPES.has(base) ? base : 'application/octet-stream';
};

/**
 * Playback routes under /launch/<token>/: package files, the SCORM wrapper,
 * the cmi5 fetch URL and the xAPI LRS for the launched registration. They
 * run on the content origin (or on the app origin for own courses when no
 * content origin is configured) and never read cookies.
 */
export async function launchRoutes(app: FastifyInstance, ctx: AppContext, options: { sameOrigin: boolean }) {
  // Per request: with several tenants each has its own app address.
  const appOrigin = () => publicUrl(ctx.config).origin;
  const frameAncestor = () => (options.sameOrigin ? "'self'" : appOrigin());
  const packages = new PackageStore(ctx.blobs);

  await app.register((scope) => {
    // Documents are opaque bytes; statements are parsed by the handler.
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser(
      '*',
      { parseAs: 'buffer', bodyLimit: 2 * 1024 * 1024 },
      (_request, body, done) => done(null, body),
    );
    const r = scope.withTypeProvider<ZodTypeProvider>();
    const config = { permission: 'public' as const, tokenAuth: true };

    const launchOf = async (request: FastifyRequest<{ Params: { token: string } }>): Promise<Launch> => {
      const launch = await resolveLaunch(ctx, request.params.token);
      // Third-party packages never run on the app origin.
      if (!launch || (options.sameOrigin && launch.kind !== 'coursecraft'))
        throw notFound('Launch not found or expired');
      return launch;
    };
    const common = (reply: FastifyReply) =>
      reply
        .header('X-Content-Type-Options', 'nosniff')
        .header('Referrer-Policy', 'no-referrer')
        .header('Cross-Origin-Resource-Policy', 'same-origin')
        .header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), display-capture=()')
        .removeHeader('X-Frame-Options');
    const xapi = (reply: FastifyReply) =>
      common(reply)
        .header('X-Experience-API-Version', '1.0.3')
        .header('Cache-Control', 'no-store')
        // LRS answers are data for the course's fetch calls, never a page.
        .header('Content-Security-Policy', "default-src 'none'; sandbox");
    const json = (raw: unknown): unknown => {
      if (!Buffer.isBuffer(raw) || !raw.length) throw badRequest('JSON body required');
      try {
        return JSON.parse(raw.toString('utf8'));
      } catch {
        throw badRequest('Invalid JSON');
      }
    };

    r.get(
      '/launch/:token/_lw/:file',
      { config, schema: { params: tokenParams.extend({ file: z.string().max(100) }) } },
      async (request, reply) => {
        const launch = await launchOf(request);
        if (launch.kind !== 'scorm12' && launch.kind !== 'scorm2004') throw notFound('Not found');
        common(reply).header(
          'Content-Security-Policy',
          `default-src 'self'; script-src 'self'; style-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors ${frameAncestor()}`,
        );
        const file = request.params.file;
        if (file === 'wrapper.html')
          return reply.type('text/html; charset=utf-8').send(wrapperHtml(appOrigin()));
        if (file === 'wrapper.css') return reply.type('text/css; charset=utf-8').send(WRAPPER_CSS);
        if ((file === 'scorm-again.min.js' || file === 'scorm-wrapper.js') && ctx.config.playerDir)
          return reply
            .type('text/javascript; charset=utf-8')
            .header('Cache-Control', 'private, max-age=3600')
            .send(createReadStream(join(ctx.config.playerDir, file)));
        throw notFound('Not found');
      },
    );

    r.post('/launch/:token/fetch', { config, schema: { params: tokenParams } }, async (request, reply) => {
      const launch = await launchOf(request);
      xapi(reply);
      return fetchAuthToken(ctx, launch);
    });

    // Server-side grading of the platform's own courses (SECURITY_AUDIT.md F-07):
    // the player submits the structured answers; the server grades them against
    // the published course version and sets the authoritative, verified result.
    r.post('/launch/:token/grade', { config, schema: { params: tokenParams } }, async (request, reply) => {
      const launch = await launchOf(request);
      // The scope parses bodies as raw buffers (xAPI), so validate here.
      const parsed = gradeSubmissionSchema.safeParse(json(request.body));
      if (!parsed.success) throw badRequest('Invalid grade submission');
      common(reply).header('Cache-Control', 'no-store');
      return gradeAttempt(ctx, launch, parsed.data);
    });

    r.get(
      '/launch/:token/xapi/about',
      { config, schema: { params: tokenParams } },
      async (request, reply) => {
        await launchOf(request);
        xapi(reply);
        return { version: ['1.0.3'] };
      },
    );

    r.post(
      '/launch/:token/xapi/statements',
      { config, schema: { params: tokenParams } },
      async (request, reply) => {
        const launch = await launchOf(request);
        xapi(reply);
        return storeStatements(ctx, launch, json(request.body));
      },
    );

    r.put(
      '/launch/:token/xapi/statements',
      { config, schema: { params: tokenParams, querystring: statementQuery } },
      async (request, reply) => {
        const launch = await launchOf(request);
        const body = json(request.body);
        if (!request.query.statementId || typeof body !== 'object' || body === null || Array.isArray(body))
          throw badRequest('statementId and one statement required');
        const id = (body as Record<string, unknown>)['id'];
        if (id !== undefined && id !== request.query.statementId)
          throw badRequest('statementId does not match');
        await storeStatements(ctx, launch, { ...body, id: request.query.statementId });
        return xapi(reply).status(204).send();
      },
    );

    r.get(
      '/launch/:token/xapi/statements',
      { config, schema: { params: tokenParams, querystring: statementQuery } },
      async (request, reply) => {
        const launch = await launchOf(request);
        xapi(reply);
        return getStatements(ctx, launch, request.query);
      },
    );

    for (const [path, kind] of DOCUMENT_PATHS) {
      const url = `/launch/:token/xapi/${path}`;
      const schema = { params: tokenParams, querystring: documentQuery };
      const keyOf = (q: z.infer<typeof documentQuery>) => ({
        kind,
        activityId: q.activityId,
        agent: q.agent,
        registration: q.registration,
        docId: kind === 'state' ? q.stateId : q.profileId,
      });
      r.get(url, { config, schema }, async (request, reply) => {
        const launch = await launchOf(request);
        xapi(reply);
        const result = await getDocument(ctx, launch, keyOf(request.query));
        if ('list' in result) return result.list;
        return reply
          .header('ETag', `"${result.document.etag}"`)
          .header('Last-Modified', result.document.updated_at.toUTCString())
          .header('Content-Disposition', 'attachment')
          .type(inertType(result.document.content_type))
          .send(result.document.content);
      });
      for (const method of ['put', 'post'] as const)
        r[method](url, { config, schema }, async (request, reply) => {
          const launch = await launchOf(request);
          const body = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
          await writeDocument(
            ctx,
            launch,
            keyOf(request.query),
            body,
            request.headers['content-type'] ?? '',
            method === 'post',
          );
          return xapi(reply).status(204).send();
        });
      r.delete(url, { config, schema }, async (request, reply) => {
        const launch = await launchOf(request);
        await deleteDocument(ctx, launch, keyOf(request.query));
        return xapi(reply).status(204).send();
      });
    }

    r.get('/launch/:token/*', { config, schema: { params: fileParams } }, async (request, reply) => {
      const launch = await launchOf(request);
      const file = await packages.file(launch.packageId, request.params['*']);
      if (!file) throw notFound('File not found');
      common(reply)
        // Package pages may also sit in the SCORM wrapper's frame (same origin).
        .header(
          'Content-Security-Policy',
          playbackCsp(launch.kind, options.sameOrigin ? "'self'" : `'self' ${appOrigin()}`),
        )
        .header('Cache-Control', 'private, max-age=300')
        .header('Accept-Ranges', 'bytes')
        .type(file.type);
      const match = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? '');
      if (match && (match[1] || match[2])) {
        const start = match[1] ? Number(match[1]) : Math.max(0, file.size - Number(match[2]));
        const end = match[1] && match[2] ? Math.min(Number(match[2]), file.size - 1) : file.size - 1;
        if (start > end || start >= file.size)
          return reply.status(416).header('Content-Range', `bytes */${file.size}`).send();
        return reply
          .status(206)
          .header('Content-Range', `bytes ${start}-${end}/${file.size}`)
          .header('Content-Length', String(end - start + 1))
          .send(await file.open({ start, end }));
      }
      return reply.header('Content-Length', String(file.size)).send(await file.open());
    });
    return Promise.resolve();
  });
}
