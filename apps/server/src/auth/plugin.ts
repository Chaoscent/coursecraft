// SPDX-License-Identifier: Apache-2.0
import { publicUrl } from '../tenancy/origins.js';
import { PERMISSIONS, rolesGrant, type Permission } from '@coursecraft/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { hmac, safeEqual } from '../crypto/tokens.js';
import type { AppContext, AuthState } from '../http/context.js';
import { AppError } from '../http/errors.js';
import { SESSION_COOKIE, type ResolvedSession } from './sessions.js';

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function setSessionCookie(reply: FastifyReply, ctx: AppContext, token: string): void {
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: ctx.sessions.cookieMaxAgeSeconds(),
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, secure: true, sameSite: 'lax' });
}

export function toAuthState(ctx: AppContext, s: ResolvedSession): AuthState {
  return {
    sessionId: s.sessionId,
    userId: s.userId,
    email: s.email,
    displayName: s.displayName,
    locale: s.locale,
    roles: s.roles,
    permissions: PERMISSIONS.filter((p) => rolesGrant(s.roles, p)),
    mustChangePassword: s.mustChangePassword,
    totpEnabled: s.totpEnabled,
    csrfToken: ctx.sessions.csrfToken(s.sessionId),
  };
}

/**
 * Same-origin check for state-changing requests. Browsers send `Origin` on
 * every cross-origin and same-origin POST; `Sec-Fetch-Site` is the fallback.
 */
function sameOrigin(request: FastifyRequest, expected: string): boolean {
  const origin = request.headers.origin;
  if (origin) return origin === expected;
  return request.headers['sec-fetch-site'] === 'same-origin';
}

/**
 * Central authentication and authorization, run for every request before the
 * body is parsed: session lookup in the database, CSRF and origin checks for
 * state-changing requests, and the permission declared by the route.
 */
export function registerAuth(app: FastifyInstance, ctx: AppContext): void {
  app.decorateRequest('auth', null);
  app.decorateRequest('ipHmac', '');

  app.addHook('onRequest', async (request, reply) => {
    request.ipHmac = hmac(ctx.config.ipPepper, request.ip);
    const permission = request.routeOptions.config.permission;
    // Unknown routes (404 handler) carry no permission and need no session.
    if (!permission) return;
    // Launch routes authenticate by the token in the path and never look at cookies.
    if (request.routeOptions.config.tokenAuth) return;

    const token = request.cookies[SESSION_COOKIE];
    if (token) {
      const resolved = await ctx.sessions.resolve(token);
      if (resolved) {
        request.auth = toAuthState(ctx, resolved);
        if (resolved.rotatedToken) setSessionCookie(reply, ctx, resolved.rotatedToken);
      } else {
        clearSessionCookie(reply);
      }
    }

    if (UNSAFE.has(request.method) && !request.routeOptions.config.crossSite) {
      if (!sameOrigin(request, publicUrl(ctx.config).origin))
        throw new AppError('forbidden', 'Cross-origin request rejected');
      const type = request.headers['content-type'] ?? '';
      if (type.startsWith('multipart/') && !request.routeOptions.config.allowMultipart) {
        throw new AppError('unsupported_media_type', 'Unsupported content type');
      }
      if (request.auth) {
        const sent = request.headers['x-csrf-token'];
        if (typeof sent !== 'string' || !safeEqual(sent, request.auth.csrfToken)) {
          throw new AppError('forbidden', 'Missing or invalid CSRF token');
        }
      }
    }

    if (permission === 'public') return;
    if (!request.auth) throw new AppError('unauthenticated', 'Sign-in required');
    if (request.auth.mustChangePassword && !request.routeOptions.config.allowDuringPasswordChange) {
      throw new AppError('password_change_required', 'Change your password first');
    }
    if (!request.auth.permissions.includes(permission satisfies Permission)) {
      throw new AppError('forbidden', 'Missing permission');
    }
  });
}

export function requireAuth(request: FastifyRequest): AuthState {
  if (!request.auth) throw new AppError('unauthenticated', 'Sign-in required');
  return request.auth;
}
