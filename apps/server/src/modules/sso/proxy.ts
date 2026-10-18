// SPDX-License-Identifier: Apache-2.0
import { timingSafeEqual } from 'node:crypto';
import { BlockList, isIP } from 'node:net';
import type { FastifyRequest } from 'fastify';
import type { AppContext } from '../../http/context.js';
import { directoryLookup } from './ldap.js';
import { enabledProvider, resolveUser, secretAad, type Outcome } from './service.js';

interface ProxyConfig {
  header: string;
  trustedProxies: string[];
  secretHeader: string;
  stripRealm: boolean;
  directoryProviderId: string | null;
}

/** `::ffff:10.0.0.5` is the same host as `10.0.0.5`. */
const plainAddress = (address: string): string => address.replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i, '$1');

export function isTrustedPeer(address: string | undefined, trusted: string[]): boolean {
  if (!address) return false;
  const peer = plainAddress(address);
  const family = isIP(peer);
  if (!family) return false;
  const list = new BlockList();
  for (const entry of trusted) {
    const [host = '', bits] = entry.split('/');
    const kind = isIP(host);
    if (!kind) continue;
    const type = kind === 4 ? 'ipv4' : 'ipv6';
    if (bits === undefined) list.addAddress(host, type);
    else if (Number(bits) <= (kind === 4 ? 32 : 128)) list.addSubnet(host, Number(bits), type);
  }
  return list.check(peer, family === 4 ? 'ipv4' : 'ipv6');
}

const sameSecret = (given: string, expected: string): boolean => {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

/** `DOMAIN\user` and `user@REALM` become `user`. */
export function accountName(principal: string, stripRealm: boolean): string {
  if (!stripRealm) return principal;
  const afterDomain = principal.slice(principal.lastIndexOf('\\') + 1);
  return afterDomain.split('@')[0] ?? afterDomain;
}

/**
 * Signs in a person whom a reverse proxy in front of Coursecraft has already
 * authenticated (Kerberos or NTLM through Apache, IIS, ...). The header is only
 * believed when the TCP peer is a configured proxy and, if set, the shared
 * secret header matches; the proxy must overwrite any value sent by clients.
 */
export async function proxyLogin(
  ctx: AppContext,
  providerId: string,
  request: FastifyRequest,
): Promise<Outcome> {
  const row = await enabledProvider(ctx, providerId, 'proxy');
  const c = row.config as unknown as ProxyConfig;
  const peer = request.socket.remoteAddress;
  if (!isTrustedPeer(peer, c.trustedProxies)) {
    ctx.log.warn({ provider: row.id, peer }, 'proxy sign-in from an address that is not a trusted proxy');
    return { error: 'denied' };
  }
  if (c.secretHeader) {
    const given = request.headers[c.secretHeader];
    const expected = row.secret ? ctx.box.open(row.secret, secretAad(row.id)) : null;
    if (typeof given !== 'string' || expected === null || !sameSecret(given, expected)) {
      ctx.log.warn({ provider: row.id, peer }, 'proxy sign-in with a wrong shared secret');
      return { error: 'denied' };
    }
  }
  const value = request.headers[c.header];
  // Several values mean something upstream appended to a header the proxy should have replaced.
  if (typeof value !== 'string') return { error: 'failed' };
  const principal = value.trim();
  // eslint-disable-next-line no-control-regex -- control characters never belong in an account name
  if (!principal || principal.length > 256 || /[\x00-\x1f\x7f]/.test(principal)) return { error: 'failed' };
  const username = accountName(principal, c.stripRealm);

  if (c.directoryProviderId) {
    try {
      const directory = await enabledProvider(ctx, c.directoryProviderId, 'ldap');
      return await directoryLookup(ctx, directory, username);
    } catch (error) {
      ctx.log.warn({ err: error, provider: row.id }, 'directory lookup for proxy sign-in failed');
      return { error: 'failed' };
    }
  }
  return resolveUser(ctx, row, {
    subject: `proxy:${principal.toLowerCase()}`,
    email: principal.includes('@') ? principal : null,
    // The proxy proved the account through Kerberos.
    emailVerified: true,
    name: username,
    locale: null,
  });
}
