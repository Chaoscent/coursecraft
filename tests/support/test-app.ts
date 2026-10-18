// SPDX-License-Identifier: Apache-2.0
/**
 * Builds the real application against a fresh copy of the migrated database,
 * connected as the restricted app role, plus helpers to act as users.
 */
import type { Role } from '@coursecraft/shared';
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

export const ORIGIN = 'https://coursecraft.test';
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
  /** Connection URL of the migrator role (owner of the tables; tenants). */
  migratorUrl: string;
  /** Connection URL of the app role. */
  databaseUrl: string;
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

/** Small-organisation mode: every trainer sees every learner (tests that are about the LMS itself). */
export async function trainersSeeEveryone(t: TestApp): Promise<void> {
  await t.ctx.db
    .insertInto('settings')
    .values({ key: 'trainer_scope', value: JSON.stringify({ mode: 'all' }) })
    .execute();
}

export function sessionCookie(res: LightMyRequestResponse): string | undefined {
  return res.cookies.find((c) => c.name === SESSION_COOKIE)?.value;
}

export async function createTestApp(env: Record<string, string> = {}): Promise<TestApp> {
  const pg = inject('pg');
  const s3 = inject('s3');
  const { url, migratorUrl, drop } = await createTestDatabase(pg);
  const config = loadConfig({
    COURSECRAFT_PUBLIC_URL: ORIGIN,
    COURSECRAFT_DATABASE_URL: url,
    COURSECRAFT_MASTER_KEY: randomBytes(32).toString('base64'),
    COURSECRAFT_IP_PEPPER: randomBytes(32).toString('base64'),
    COURSECRAFT_LOG_LEVEL: 'fatal',
    COURSECRAFT_DATA_DIR: mkdtempSync(join(tmpdir(), 'cc-data-')),
    COURSECRAFT_PLAYER_DIR: new URL('../../packages/player/dist/', import.meta.url).pathname,
    // With CC_TEST_STORAGE=s3 the same suite runs against object storage, one key prefix per app.
    ...(s3
      ? {
          COURSECRAFT_STORAGE: 's3',
          COURSECRAFT_S3_ENDPOINT: s3.endpoint,
          COURSECRAFT_S3_REGION: s3.region,
          COURSECRAFT_S3_BUCKET: s3.bucket,
          COURSECRAFT_S3_ACCESS_KEY_ID: s3.accessKeyId,
          COURSECRAFT_S3_SECRET_ACCESS_KEY: s3.secretAccessKey,
          COURSECRAFT_S3_KEY_PREFIX: `test-${randomBytes(6).toString('hex')}`,
        }
      : {}),
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
  const request: TestApp['request'] = async (actor, method, url, body, headers = {}) => {
    const res = await app.inject({
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
    // Follow session rotation (e.g. after group changes), like a browser.
    const rotated = sessionCookie(res);
    if (actor && rotated) actor.cookie = rotated;
    return res;
  };

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
    migratorUrl,
    databaseUrl: url,
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
