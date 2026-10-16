// SPDX-License-Identifier: Apache-2.0
import { generateSync } from 'otplib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../../apps/server/src/auth/sessions.js';
import { hashToken, randomToken } from '../../apps/server/src/crypto/tokens.js';
import { createTestApp, PASSWORD, sessionCookie, type TestApp } from '../support/test-app.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => t.close());

const me = (cookie: string) =>
  t.app.inject({ method: 'GET', url: '/api/session', cookies: { [SESSION_COOKIE]: cookie } });

describe('login', () => {
  it('sets a hardened host-only cookie', async () => {
    const user = await t.createUser(['learner']);
    const res = await t.request(null, 'POST', '/api/auth/login', { email: user.email, password: PASSWORD });
    const cookie = res.cookies.find((c) => c.name === SESSION_COOKIE);
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax', path: '/' });
    expect(cookie?.domain).toBeUndefined();
    expect(Buffer.from(cookie?.value ?? '', 'base64url')).toHaveLength(32);
  });

  it('stores only the token hash', async () => {
    const actor = await t.actor(['learner']);
    const rows = await t.ctx.db
      .selectFrom('sessions')
      .select('token_hash')
      .where('user_id', '=', actor.userId)
      .execute();
    expect(rows.map((r) => r.token_hash)).toContain(hashToken(actor.cookie));
    expect(rows.some((r) => r.token_hash === actor.cookie)).toBe(false);
  });

  it('gives the same answer for unknown users and wrong passwords', async () => {
    const user = await t.createUser(['learner']);
    const wrong = await t.request(null, 'POST', '/api/auth/login', {
      email: user.email,
      password: 'nope nope nope',
    });
    const unknown = await t.request(null, 'POST', '/api/auth/login', {
      email: 'nobody@example.org',
      password: 'nope nope nope',
    });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json().error.message).toBe(unknown.json().error.message);
  });

  it('locks an account after repeated failures', async () => {
    const user = await t.createUser(['learner']);
    for (let i = 0; i < 10; i++) {
      await t.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        remoteAddress: `10.0.0.${i + 1}`,
        headers: { origin: 'https://lernwerk.test', 'content-type': 'application/json' },
        payload: JSON.stringify({ email: user.email, password: 'wrong password!' }),
      });
    }
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      remoteAddress: '10.0.1.1',
      headers: { origin: 'https://lernwerk.test', 'content-type': 'application/json' },
      payload: JSON.stringify({ email: user.email, password: PASSWORD }),
    });
    expect(res.statusCode).toBe(401);
  });

  it('rate-limits login attempts per client', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      const res = await t.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        remoteAddress: '10.9.9.9',
        headers: { origin: 'https://lernwerk.test', 'content-type': 'application/json' },
        payload: JSON.stringify({ email: 'x@example.org', password: 'whatever!!' }),
      });
      statuses.push(res.statusCode);
    }
    expect(statuses).toContain(429);
  });
});

describe('session validation on every request', () => {
  it('rejects unknown and malformed tokens', async () => {
    expect((await me(randomToken())).json().session).toBeNull();
    expect((await me("' OR 1=1 --")).json().session).toBeNull();
  });

  it('logout invalidates the token server-side', async () => {
    const actor = await t.actor(['learner']);
    expect((await t.request(actor, 'POST', '/api/auth/logout')).statusCode).toBe(200);
    expect((await me(actor.cookie)).json().session).toBeNull();
    expect((await t.request(actor, 'GET', '/api/account/sessions')).statusCode).toBe(401);
  });

  it('expires idle sessions', async () => {
    const actor = await t.actor(['learner']);
    await t.ctx.db
      .updateTable('sessions')
      .set({ idle_expires_at: new Date(Date.now() - 1000) })
      .where('user_id', '=', actor.userId)
      .execute();
    expect((await me(actor.cookie)).json().session).toBeNull();
  });

  it('expires sessions at the absolute timeout', async () => {
    const actor = await t.actor(['learner']);
    await t.ctx.db
      .updateTable('sessions')
      .set({ absolute_expires_at: new Date(Date.now() - 1000) })
      .where('user_id', '=', actor.userId)
      .execute();
    expect((await me(actor.cookie)).json().session).toBeNull();
  });

  it('rejects revoked sessions', async () => {
    const actor = await t.actor(['learner']);
    await t.ctx.db.deleteFrom('sessions').where('user_id', '=', actor.userId).execute();
    expect((await t.request(actor, 'GET', '/api/account/sessions')).statusCode).toBe(401);
  });

  it('reads roles fresh on every request', async () => {
    const actor = await t.actor(['admin']);
    expect((await t.request(actor, 'GET', '/api/users')).statusCode).toBe(200);
    await t.ctx.db.deleteFrom('user_roles').where('user_id', '=', actor.userId).execute();
    expect((await t.request(actor, 'GET', '/api/users')).statusCode).toBe(403);
  });
});

describe('session fixation and rotation', () => {
  it('never authenticates a token that the client brought', async () => {
    const victim = await t.createUser(['learner']);
    const planted = await t.actor(['learner']);
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: {
        origin: 'https://lernwerk.test',
        'content-type': 'application/json',
        'x-csrf-token': planted.csrf,
      },
      cookies: { [SESSION_COOKIE]: planted.cookie },
      payload: JSON.stringify({ email: victim.email, password: PASSWORD }),
    });
    const issued = sessionCookie(res);
    expect(issued).toBeDefined();
    expect(issued).not.toBe(planted.cookie);
    expect((await me(planted.cookie)).json().session).toBeNull();
  });

  it('rotates the token after a role change', async () => {
    const admin = await t.actor(['admin']);
    const user = await t.actor(['learner']);
    const res = await t.request(admin, 'PATCH', `/api/users/${user.userId}`, {
      roles: ['learner', 'author'],
    });
    expect(res.statusCode).toBe(200);
    const next = await me(user.cookie);
    const rotated = sessionCookie(next);
    expect(rotated).toBeDefined();
    expect(rotated).not.toBe(user.cookie);
    expect(next.json().session.user.roles).toContain('author');
    expect((await me(user.cookie)).json().session).toBeNull();
    expect((await me(rotated ?? '')).json().session).not.toBeNull();
  });

  it('ends all sessions when an admin disables the user', async () => {
    const admin = await t.actor(['admin']);
    const user = await t.actor(['learner']);
    await t.request(admin, 'PATCH', `/api/users/${user.userId}`, { status: 'disabled' });
    expect((await me(user.cookie)).json().session).toBeNull();
    const rows = await t.ctx.db
      .selectFrom('sessions')
      .select('id')
      .where('user_id', '=', user.userId)
      .execute();
    expect(rows).toHaveLength(0);
  });

  it('ends all sessions on admin password reset and forces a change', async () => {
    const admin = await t.actor(['admin']);
    const user = await t.actor(['learner']);
    await t.request(admin, 'POST', `/api/users/${user.userId}/reset-password`, {
      password: 'temporary password 1',
    });
    expect((await me(user.cookie)).json().session).toBeNull();
    const again = await t.login(user.email, 'temporary password 1');
    expect((await t.request(again, 'GET', '/api/account/sessions')).statusCode).toBe(403);
    const changed = await t.request(again, 'POST', '/api/account/password', {
      currentPassword: 'temporary password 1',
      newPassword: 'my own new password',
    });
    expect(changed.statusCode).toBe(200);
  });

  it('password change ends other sessions and rotates the current one', async () => {
    const user = await t.createUser(['learner']);
    const a = await t.login(user.email);
    const b = await t.login(user.email);
    const res = await t.request(a, 'POST', '/api/account/password', {
      currentPassword: PASSWORD,
      newPassword: 'another long password',
    });
    expect(res.statusCode).toBe(200);
    const rotated = sessionCookie(res);
    expect(rotated).toBeDefined();
    expect((await me(b.cookie)).json().session).toBeNull();
    expect((await me(a.cookie)).json().session).toBeNull();
    expect((await me(rotated ?? '')).json().session).not.toBeNull();
  });

  it('"end other sessions" keeps only the current one', async () => {
    const user = await t.createUser(['learner']);
    const a = await t.login(user.email);
    const b = await t.login(user.email);
    expect((await t.request(a, 'POST', '/api/account/sessions/end-others')).json()).toEqual({ ended: 1 });
    expect((await me(b.cookie)).json().session).toBeNull();
    expect((await me(a.cookie)).json().session).not.toBeNull();
  });
});

describe('two-factor authentication', () => {
  it('requires a valid, non-replayed code after the password', async () => {
    const user = await t.createUser(['learner']);
    const actor = await t.login(user.email);
    const setup = await t.request(actor, 'POST', '/api/account/totp/setup');
    const { secret } = setup.json<{ secret: string }>();
    const confirm = await t.request(actor, 'POST', '/api/account/totp/confirm', {
      code: generateSync({ secret }),
    });
    expect(confirm.statusCode).toBe(200);

    const step1 = await t.request(null, 'POST', '/api/auth/login', { email: user.email, password: PASSWORD });
    expect(step1.json().status).toBe('totp_required');
    expect(sessionCookie(step1)).toBeUndefined();
    const challenge = step1.json<{ challenge: string }>().challenge;

    const wrong = await t.request(null, 'POST', '/api/auth/login/totp', { challenge, code: '000000' });
    expect(wrong.statusCode).toBe(401);

    // The code used for confirmation is already consumed (replay).
    const replay = await t.request(null, 'POST', '/api/auth/login/totp', {
      challenge,
      code: generateSync({ secret }),
    });
    expect(replay.statusCode).toBe(401);

    // A code from the next time step (within the tolerance) is accepted once.
    const next = generateSync({ secret, epoch: Math.floor(Date.now() / 1000) + 30 });
    const ok = await t.request(null, 'POST', '/api/auth/login/totp', { challenge, code: next });
    expect(ok.statusCode).toBe(200);
    expect(sessionCookie(ok)).toBeDefined();

    const stored = await t.ctx.db
      .selectFrom('users')
      .select('totp_secret')
      .where('id', '=', user.id)
      .executeTakeFirstOrThrow();
    expect(JSON.stringify(stored.totp_secret)).not.toContain(secret);
  });
});
