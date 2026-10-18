// SPDX-License-Identifier: Apache-2.0
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, normalize, sep } from 'node:path';
import type { AppConfig } from '../config/env.js';
import { AppError } from './errors.js';
import { contentSecurityPolicy } from './security-headers.js';

/**
 * Serves the built web app. Hashed assets are cached forever; every other
 * path falls back to index.html (client-side routing).
 */
export async function registerWebApp(app: FastifyInstance, root: string, config: AppConfig): Promise<void> {
  await app.register(fastifyStatic, { root, serve: false });
  const base = normalize(root) + sep;
  const indexHtml = readFileSync(join(root, 'index.html'), 'utf8');

  app.get('/*', { config: { permission: 'public' } }, async (request, reply) => {
    const path = request.url.split('?')[0] ?? '/';
    if (path.startsWith('/api/')) throw new AppError('not_found', 'Not found');
    const file = normalize(join(root, decodeURIComponent(path)));
    // The operator console belongs to the operator process only.
    const inside = file.startsWith(base) && path !== '/operator.html';
    if (inside && existsSync(file) && statSync(file).isFile()) {
      const immutable = path.startsWith('/assets/');
      return reply
        .header('Cache-Control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache')
        .sendFile(file.slice(base.length));
    }
    // index.html carries a fresh style nonce for the UI library (see CSP).
    const nonce = randomBytes(16).toString('base64');
    return reply
      .header('Cache-Control', 'no-store')
      .header('Content-Security-Policy', contentSecurityPolicy(config, nonce))
      .type('text/html; charset=utf-8')
      .send(indexHtml.replace('<head>', `<head><meta property="csp-nonce" nonce="${nonce}" />`));
  });
}
