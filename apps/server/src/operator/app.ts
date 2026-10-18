// SPDX-License-Identifier: Apache-2.0
import fastifyCookie from '@fastify/cookie';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import {
  billingPlanInputSchema,
  billingPlanSchema,
  billingPlansSchema,
  idParamSchema,
  okSchema,
  operatorPaymentLinkRequestSchema,
  operatorUrlSchema,
  operatorCreatedSchema,
  operatorDeleteSchema,
  operatorInstallationSchema,
  operatorLogSchema,
  operatorResetLinkSchema,
  operatorTenantDetailSchema,
  operatorLoginSchema,
  operatorNewTenantSchema,
  operatorSessionSchema,
  operatorSetupTokenSchema,
  operatorTenantsSchema,
  operatorUpdateTenantSchema,
} from '@coursecraft/shared';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppError } from '../http/errors.js';
import { installErrorHandling } from '../http/app.js';
import type { OperatorConfig } from './config.js';
import {
  addTenant,
  adminResetLink,
  deletePlan,
  installation,
  listPlans,
  listTenants,
  operatorLog,
  paymentLink,
  portalLink,
  removeTenant,
  savePlan,
  setupToken,
  tenantDetail,
  updateTenant,
  type OperatorDeps,
} from './service.js';
import { z } from 'zod';

const COOKIE = '__Host-cc_operator';
const SESSION_MS = 8 * 3_600_000;

const digest = (value: string) => createHash('sha256').update(value).digest();

/**
 * The operator console: a separate process with the table owner's rights,
 * meant to be reachable only from the operator's machine (localhost, SSH
 * tunnel, kubectl port-forward). Signs in with the operator password;
 * sessions live in memory and end with the process.
 */
export async function buildOperatorApp(config: OperatorConfig, deps: OperatorDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: config.logLevel, redact: ['req.headers.cookie', 'body.password'] },
    bodyLimit: 64 * 1024,
  }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  installErrorHandling(app);
  await app.register(fastifyCookie);
  await app.register(fastifyRateLimit, { global: false });

  const sessions = new Map<string, { csrf: string; expires: number }>();
  const expected = digest(config.password);

  const sessionOf = (request: FastifyRequest) => {
    const token = request.cookies[COOKIE];
    if (!token) return null;
    const session = sessions.get(digest(token).toString('hex'));
    if (!session || session.expires < Date.now()) return null;
    return session;
  };

  /** Every operator action needs the session, and changes also its CSRF token and a same-origin request. */
  const guard = async (request: FastifyRequest) => {
    const session = sessionOf(request);
    if (!session) throw new AppError('unauthenticated', 'Sign in first');
    if (request.method !== 'GET') {
      const origin = request.headers.origin;
      if (!origin || origin !== `${request.protocol}://${request.host}`)
        throw new AppError('forbidden', 'Cross-origin request rejected');
      const csrf = request.headers['x-csrf-token'];
      if (typeof csrf !== 'string' || csrf !== session.csrf)
        throw new AppError('forbidden', 'Invalid CSRF token');
    }
    return Promise.resolve();
  };

  const r = app.withTypeProvider<ZodTypeProvider>();
  r.get('/healthz', () => Promise.resolve({ status: 'ok' as const }));

  r.get('/api/operator/session', { schema: { response: { 200: operatorSessionSchema } } }, (request) => {
    const session = sessionOf(request);
    return Promise.resolve({ authenticated: !!session, csrfToken: session?.csrf ?? null });
  });

  r.post(
    '/api/operator/login',
    {
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
      schema: { body: operatorLoginSchema, response: { 200: operatorSessionSchema } },
    },
    (request, reply) => {
      if (!timingSafeEqual(digest(request.body.password), expected)) {
        request.log.warn('operator sign-in with a wrong password');
        throw new AppError('invalid_credentials', 'Wrong password');
      }
      const token = randomBytes(32).toString('base64url');
      const csrf = randomBytes(32).toString('base64url');
      sessions.set(digest(token).toString('hex'), { csrf, expires: Date.now() + SESSION_MS });
      void reply.setCookie(COOKIE, token, {
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        maxAge: SESSION_MS / 1000,
      });
      request.log.info('operator signed in');
      return Promise.resolve({ authenticated: true, csrfToken: csrf });
    },
  );

  r.post(
    '/api/operator/logout',
    { preValidation: guard, schema: { response: { 200: okSchema } } },
    (request, reply) => {
      const token = request.cookies[COOKIE];
      if (token) sessions.delete(digest(token).toString('hex'));
      void reply.clearCookie(COOKIE, { path: '/', httpOnly: true, secure: true, sameSite: 'strict' });
      return Promise.resolve({ ok: true as const });
    },
  );

  r.get(
    '/api/operator/tenants',
    { preValidation: guard, schema: { response: { 200: operatorTenantsSchema } } },
    async () => ({ items: await listTenants(deps) }),
  );

  r.post(
    '/api/operator/tenants',
    {
      preValidation: guard,
      schema: { body: operatorNewTenantSchema, response: { 200: operatorCreatedSchema } },
    },
    async (request) => {
      const created = await addTenant(deps, request.body);
      request.log.info({ tenant: created.id }, 'organisation created');
      return created;
    },
  );

  r.patch(
    '/api/operator/tenants/:id',
    {
      preValidation: guard,
      schema: { params: idParamSchema, body: operatorUpdateTenantSchema, response: { 200: okSchema } },
    },
    async (request) => {
      await updateTenant(deps, request.params.id, request.body);
      request.log.info(
        { tenant: request.params.id, change: Object.keys(request.body) },
        'organisation changed',
      );
      return { ok: true as const };
    },
  );

  r.get(
    '/api/operator/tenants/:id/detail',
    {
      preValidation: guard,
      schema: { params: idParamSchema, response: { 200: operatorTenantDetailSchema } },
    },
    async (request) => tenantDetail(deps, request.params.id),
  );

  r.post(
    '/api/operator/tenants/:id/admins/:userId/reset-link',
    {
      preValidation: guard,
      schema: {
        params: z.object({ id: z.uuid(), userId: z.uuid() }),
        response: { 200: operatorResetLinkSchema },
      },
    },
    async (request) => {
      const result = await adminResetLink(deps, request.params.id, request.params.userId);
      request.log.warn({ tenant: request.params.id }, 'password link for an administrator issued');
      return result;
    },
  );

  r.get(
    '/api/operator/plans',
    { preValidation: guard, schema: { response: { 200: billingPlansSchema } } },
    async () => listPlans(deps),
  );

  r.post(
    '/api/operator/plans',
    { preValidation: guard, schema: { body: billingPlanInputSchema, response: { 200: billingPlanSchema } } },
    async (request) => savePlan(deps, null, request.body),
  );

  r.put(
    '/api/operator/plans/:id',
    {
      preValidation: guard,
      schema: { params: idParamSchema, body: billingPlanInputSchema, response: { 200: billingPlanSchema } },
    },
    async (request) => savePlan(deps, request.params.id, request.body),
  );

  r.post(
    '/api/operator/plans/:id/delete',
    { preValidation: guard, schema: { params: idParamSchema, response: { 200: okSchema } } },
    async (request) => {
      await deletePlan(deps, request.params.id);
      return { ok: true as const };
    },
  );

  r.post(
    '/api/operator/tenants/:id/payment-link',
    {
      preValidation: guard,
      schema: {
        params: idParamSchema,
        body: operatorPaymentLinkRequestSchema,
        response: { 200: operatorUrlSchema },
      },
    },
    async (request) => paymentLink(deps, request.params.id, request.body.planId),
  );

  r.post(
    '/api/operator/tenants/:id/portal-link',
    { preValidation: guard, schema: { params: idParamSchema, response: { 200: operatorUrlSchema } } },
    async (request) => portalLink(deps, request.params.id),
  );

  r.get(
    '/api/operator/installation',
    { preValidation: guard, schema: { response: { 200: operatorInstallationSchema } } },
    async () => installation(deps),
  );

  r.get(
    '/api/operator/log',
    { preValidation: guard, schema: { response: { 200: operatorLogSchema } } },
    async () => operatorLog(deps),
  );

  r.post(
    '/api/operator/tenants/:id/setup-token',
    { preValidation: guard, schema: { params: idParamSchema, response: { 200: operatorSetupTokenSchema } } },
    async (request) => setupToken(deps, request.params.id),
  );

  r.post(
    '/api/operator/tenants/:id/delete',
    {
      preValidation: guard,
      schema: { params: idParamSchema, body: operatorDeleteSchema, response: { 200: okSchema } },
    },
    async (request) => {
      await removeTenant(deps, request.params.id, request.body.confirmName);
      request.log.warn({ tenant: request.params.id }, 'organisation deleted');
      return { ok: true as const };
    },
  );

  // The console page: the operator entry of the web build, with a style nonce for the UI library.
  const page = join(config.webDir, 'operator.html');
  if (existsSync(page)) {
    const html = readFileSync(page, 'utf8');
    await app.register(fastifyStatic, { root: join(config.webDir, 'assets'), prefix: '/assets/' });
    r.get('/', (_request, reply) => {
      const nonce = randomBytes(16).toString('base64');
      return reply
        .header('Cache-Control', 'no-store')
        .header(
          'Content-Security-Policy',
          `default-src 'self'; script-src 'self'; style-src 'self' 'nonce-${nonce}'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`,
        )
        .header('X-Frame-Options', 'DENY')
        .header('Referrer-Policy', 'same-origin')
        .type('text/html; charset=utf-8')
        .send(html.replace('<head>', `<head><meta property="csp-nonce" nonce="${nonce}" />`));
    });
  }
  return app;
}
