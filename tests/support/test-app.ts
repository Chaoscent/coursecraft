// SPDX-License-Identifier: Apache-2.0
/**
 * Builds the real application against a fresh copy of the migrated database,
 * connected as the restricted app role, plus helpers to act as users.
 */
import type { Role } from '@lernwerk/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inject } from 'vitest';
import { hashPassword } from '../../apps/server/src/auth/passwords.js';
import { SESSION_COOKIE } from '../../apps/server/src/auth/sessions.js';
import { loadConfig } from '../../apps/server/src/config/env.js';
import { createContext } from '../../apps/server/src/context-factory.js';
import { createDatabase } from '../../apps/server/src/db/connection.js';
import { buildApp } from '../../apps/server/src/http/app.js';
import type { AppContext } from '../../apps/server/src/http/context.js';
import type { RegisteredRoute } from '../../apps/server/src/http/routes.js';
import { createTestDatabase } from './database.js';

export const ORIGIN = 'https://lernwerk.test';
export const PASSWORD = 'correct horse battery staple';

export interface Actor {
  userId: string;
  email: string;
  cookie: string;
  csrf: string;
}

export interface TestApp {
  app: FastifyInstance;
  ctx: AppContext;
  routes: RegisteredRoute[];
  close(): Promise<void>;
  createUser(
    roles: Role[],
    options?: { email?: string; password?: string },
  ): Promise<{ id: string; email: string }>;
  login(email: string, password?: string): Promise<Actor>;
  actor(roles: Role[]): Promise<Actor>;
  request(
    actor: Actor | null,
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    url: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<LightMyRequestResponse>;
}

export function sessionCookie(res: LightMyRequestResponse): string | undefined {
  return res.cookies.find((c) => c.name === SESSION_COOKIE)?.value;
}

export async function createTestApp(env: Record<string, string> = {}): Promise<TestApp> {
  const pg = inject('pg');
  const { url, drop } = await createTestDatabase(pg);
  const config = loadConfig({
    LERNWERK_PUBLIC_URL: ORIGIN,
    LERNWERK_DATABASE_URL: url,
    LERNWERK_MASTER_KEY: randomBytes(32).toString('base64'),
    LERNWERK_IP_PEPPER: randomBytes(32).toString('base64'),
    LERNWERK_LOG_LEVEL: 'fatal',
    LERNWERK_DATA_DIR: mkdtempSync(join(tmpdir(), 'lw-data-')),
    LERNWERK_PLAYER_DIR: new URL('../../packages/player/dist/', import.meta.url).pathname,
    ...env,
  });
  const ctx = createContext(config);
  const { app, routes } = await buildApp({
    config,
    ctx,
    logger: false,
    checkReadiness: () => Promise.resolve({ database: true, migrations: true }),
  });
  await app.ready();
  let counter = 0;
  let clients = 0;

  // Each helper request comes from its own address so per-IP rate limits do
  // not interfere; rate-limit tests call app.inject with a fixed address.
  const request: TestApp['request'] = (actor, method, url, body, headers = {}) =>
    app.inject({
      method,
      url,
      remoteAddress: `10.${(++clients >> 16) & 255}.${(clients >> 8) & 255}.${clients & 255}`,
      headers: {
        origin: ORIGIN,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(actor ? { 'x-csrf-token': actor.csrf } : {}),
        ...headers,
      },
      ...(actor ? { cookies: { [SESSION_COOKIE]: actor.cookie } } : {}),
      ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
    });

  const createUser: TestApp['createUser'] = async (roles, options = {}) => {
    counter += 1;
    const email = options.email ?? `user${counter}-${randomBytes(3).toString('hex')}@example.org`;
    const user = await ctx.db
      .insertInto('users')
      .values({
        email,
        display_name: `User ${counter}`,
        password_hash: await hashPassword(options.password ?? PASSWORD),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    if (roles.length)
      await ctx.db
        .insertInto('user_roles')
        .values(roles.map((role) => ({ user_id: user.id, role })))
        .execute();
    return { id: user.id, email };
  };

  const login: TestApp['login'] = async (email, password = PASSWORD) => {
    const res = await request(null, 'POST', '/api/auth/login', { email, password });
    if (res.statusCode !== 200) throw new Error(`login failed: ${res.statusCode} ${res.body}`);
    const body = res.json<{ status: string; session: { csrfToken: string; user: { id: string } } }>();
    const cookie = sessionCookie(res);
    if (!cookie) throw new Error('no session cookie');
    return { userId: body.session.user.id, email, cookie, csrf: body.session.csrfToken };
  };

  return {
    app,
    ctx,
    routes,
    request,
    createUser,
    login,
    actor: async (roles) => login((await createUser(roles)).email),
    close: async () => {
      await app.close();
      await ctx.db.destroy();
      await drop();
    },
  };
}

export { createDatabase };
