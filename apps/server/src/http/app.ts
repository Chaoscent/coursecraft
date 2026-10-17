// SPDX-License-Identifier: Apache-2.0
import type { ErrorBody, ErrorCode } from '@coursecraft/shared';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import fastifyRateLimit from '@fastify/rate-limit';
import { registerAuth } from '../auth/plugin.js';
import type { AppConfig } from '../config/env.js';
import { accountRoutes } from '../modules/account/routes.js';
import { auditRoutes } from '../modules/audit/routes.js';
import { conversionRoutes } from '../modules/conversions/routes.js';
import { courseRoutes } from '../modules/courses/routes.js';
import { learningRoutes } from '../modules/learning/routes.js';
import { libraryRoutes } from '../modules/library/routes.js';
import { launchRoutes } from '../modules/lrs/routes.js';
import { reportRoutes } from '../modules/reports/routes.js';
import { aiRoutes } from '../modules/ai/routes.js';
import { mailRoutes } from '../modules/mail/routes.js';
import { passwordResetRoutes } from '../modules/password-reset/routes.js';
import { authRoutes } from '../modules/auth/routes.js';
import { groupRoutes } from '../modules/groups/routes.js';
import { setupRoutes } from '../modules/setup/routes.js';
import { userRoutes } from '../modules/users/routes.js';
import type { AppContext } from './context.js';
import { AppError } from './errors.js';
import { enforceRouteDeclarations, type RegisteredRoute } from './routes.js';
import { registerSecurityHeaders } from './security-headers.js';
import { registerWebApp } from './static.js';

export interface Readiness {
  database: boolean;
  migrations: boolean;
}

export interface AppDeps {
  config: AppConfig;
  checkReadiness: () => Promise<Readiness>;
  logger?: FastifyServerOptions['logger'];
  /** Services for the API; without it only health endpoints exist (tests). */
  ctx?: AppContext;
}

export interface BuiltApp {
  app: FastifyInstance;
  routes: RegisteredRoute[];
}

const REDACT = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
];

function errorBody(code: ErrorCode, message: string, requestId: string): ErrorBody {
  return { error: { code, message, requestId } };
}

/** Uniform JSON errors; internal details only in the log. */
export function installErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.status).send(errorBody(error.code, error.message, request.id));
    }
    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply.status(400).send(errorBody('bad_request', 'Invalid request', request.id));
    }
    const status =
      typeof error === 'object' && error !== null && 'statusCode' in error ? Number(error.statusCode) : 500;
    if (status === 413) {
      return reply.status(413).send(errorBody('payload_too_large', 'Payload too large', request.id));
    }
    if (status === 415) {
      return reply
        .status(415)
        .send(errorBody('unsupported_media_type', 'Unsupported content type', request.id));
    }
    if (status === 429) {
      return reply.status(429).send(errorBody('rate_limited', 'Too many requests', request.id));
    }
    if (status >= 400 && status < 500) {
      return reply.status(400).send(errorBody('bad_request', 'Invalid request', request.id));
    }
    request.log.error({ err: error }, 'unhandled error');
    return reply.status(500).send(errorBody('internal', 'Internal error', request.id));
  });

  app.setNotFoundHandler((request, reply) =>
    reply.status(404).send(errorBody('not_found', 'Not found', request.id)),
  );
}

export async function buildApp(deps: AppDeps): Promise<BuiltApp> {
  const { config } = deps;
  const app = Fastify({
    logger: deps.logger ?? { level: config.logLevel, redact: REDACT },
    trustProxy: config.trustProxy,
    genReqId: () => randomUUID(),
    bodyLimit: 1024 * 1024,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  const routes = enforceRouteDeclarations(app);
  await registerSecurityHeaders(app, config);

  installErrorHandling(app);

  app.get(
    '/healthz',
    {
      config: { permission: 'public' },
      schema: { response: { 200: z.object({ status: z.literal('ok') }) } },
    },
    () => Promise.resolve({ status: 'ok' as const }),
  );

  app.get(
    '/readyz',
    {
      config: { permission: 'public' },
      schema: {
        response: {
          200: z.object({ status: z.literal('ready') }),
          503: z.object({ status: z.literal('unavailable') }),
        },
      },
    },
    async (_request, reply) => {
      const readiness = await deps.checkReadiness().catch(() => ({ database: false, migrations: false }));
      // Details stay in the log; the endpoint is public.
      if (readiness.database && readiness.migrations) return { status: 'ready' as const };
      app.log.warn({ readiness }, 'not ready');
      return reply.status(503).send({ status: 'unavailable' as const });
    },
  );

  if (deps.ctx) {
    const ctx = deps.ctx;
    // Only JSON bodies (and CSV for imports); no text/plain, which simple
    // cross-site forms could send.
    app.removeContentTypeParser('text/plain');
    app.addContentTypeParser('text/csv', { parseAs: 'string' }, (_request, body, done) => done(null, body));
    await app.register(fastifyCookie);
    await app.register(fastifyRateLimit, { global: false });
    await app.register(fastifyMultipart, {
      limits: { fileSize: config.uploadMaxMb * 1024 * 1024, files: 1, fields: 5, parts: 6 },
    });
    registerAuth(app, ctx);
    authRoutes(app, ctx);
    setupRoutes(app, ctx);
    accountRoutes(app, ctx);
    userRoutes(app, ctx);
    groupRoutes(app, ctx);
    auditRoutes(app, ctx);
    courseRoutes(app, ctx, ctx.assets, config.playerDir);
    conversionRoutes(app, ctx);
    libraryRoutes(app, ctx);
    learningRoutes(app, ctx);
    reportRoutes(app, ctx);
    aiRoutes(app, ctx);
    mailRoutes(app, ctx);
    passwordResetRoutes(app, ctx);
    // Without a content origin, own courses play on the app origin.
    if (!config.contentUrl) await launchRoutes(app, ctx, { sameOrigin: true });
    if (config.webDir) await registerWebApp(app, config.webDir, config);
  }

  return { app, routes };
}
