// SPDX-License-Identifier: Apache-2.0
import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../config/env.js';
import { buildApp, type Readiness } from './app.js';
import { enforceRouteDeclarations, RouteDeclarationError } from './routes.js';

const config = loadConfig({
  LERNWERK_PUBLIC_URL: 'https://lernwerk.example.org',
  LERNWERK_CONTENT_URL: 'https://lernwerk.example.org:8443',
  LERNWERK_DATABASE_URL: 'postgres://unused',
  LERNWERK_MASTER_KEY: Buffer.alloc(32, 1).toString('base64'),
  LERNWERK_IP_PEPPER: Buffer.alloc(32, 2).toString('base64'),
});

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

async function build(readiness: Readiness = { database: true, migrations: true }) {
  const built = await buildApp({ config, checkReadiness: () => Promise.resolve(readiness), logger: false });
  close = () => built.app.close();
  return built;
}

describe('route declarations', () => {
  it('refuses routes without a permission', async () => {
    const app = Fastify({ logger: false });
    enforceRouteDeclarations(app);
    expect(() => app.get('/open', (_req, reply) => reply.send('x'))).toThrow(RouteDeclarationError);
    await app.close();
  });

  it('refuses unknown permissions', async () => {
    const app = Fastify({ logger: false });
    enforceRouteDeclarations(app);
    expect(() =>
      // @ts-expect-error unknown permission names must not type-check either
      app.get('/x', { config: { permission: 'everything' } }, (_req, reply) => reply.send('x')),
    ).toThrow(RouteDeclarationError);
    await app.close();
  });

  it('records every registered route with its permission', async () => {
    const { app, routes } = await build();
    await app.ready();
    expect(routes).toContainEqual({ method: 'GET', url: '/healthz', permission: 'public' });
    expect(routes.every((r) => r.permission)).toBe(true);
  });
});

describe('health endpoints', () => {
  it('reports liveness', async () => {
    const { app } = await build();
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('reports unavailability without details', async () => {
    const { app } = await build({ database: true, migrations: false });
    const res = await app.inject({ method: 'GET', url: '/readyz' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'unavailable' });
  });
});

describe('security headers', () => {
  it('sends a strict CSP and companions on every response', async () => {
    const { app } = await build();
    for (const url of ['/healthz', '/does-not-exist']) {
      const res = await app.inject({ method: 'GET', url });
      const csp = String(res.headers['content-security-policy']);
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("script-src 'self'");
      expect(csp).not.toContain('unsafe-inline');
      expect(csp).not.toContain('unsafe-eval');
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain('frame-src https://lernwerk.example.org:8443');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['referrer-policy']).toBe('same-origin');
      expect(res.headers['strict-transport-security']).toContain('max-age=31536000');
      expect(res.headers['permissions-policy']).toContain('geolocation=()');
    }
  });

  it('returns uniform errors for unknown routes', async () => {
    const { app } = await build();
    const res = await app.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: 'not_found' } });
  });
});
