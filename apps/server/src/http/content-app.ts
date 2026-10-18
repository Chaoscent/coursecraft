// SPDX-License-Identifier: Apache-2.0
import { tenantHook } from '../tenancy/directory.js';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AppConfig } from '../config/env.js';
import { launchRoutes } from '../modules/lrs/routes.js';
import { installErrorHandling } from './app.js';
import type { AppContext } from './context.js';
import { enforceRouteDeclarations } from './routes.js';

/**
 * Listener for the content origin. It serves nothing but /launch/<token>/…
 * and a health check, has no cookie support, and never sees a session.
 */
export async function buildContentApp(config: AppConfig, ctx: AppContext): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: config.logLevel, redact: ['req.headers.cookie', 'req.headers.authorization'] },
    trustProxy: config.trustProxy,
    genReqId: () => randomUUID(),
  }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.addHook('onRequest', tenantHook(config, ctx.tenants));
  enforceRouteDeclarations(app);
  installErrorHandling(app);
  app.get(
    '/healthz',
    {
      config: { permission: 'public' },
      schema: { response: { 200: z.object({ status: z.literal('ok') }) } },
    },
    () => Promise.resolve({ status: 'ok' as const }),
  );
  await launchRoutes(app, ctx, { sameOrigin: false });
  return app;
}
