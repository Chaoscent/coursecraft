// SPDX-License-Identifier: Apache-2.0
import { Client, InvalidCredentialsError } from 'ldapts';
import { SSO_ROLES } from '@coursecraft/shared';
import type { AppContext } from '../../http/context.js';
import { enabledProvider, resolveUser, secretAad, type Outcome, type Row } from './service.js';

type Role = (typeof SSO_ROLES)[number];

const TIMEOUT_MS = 10_000;

interface LdapConfig {
  url: string;
  startTls: boolean;
  caCert: string;
  tlsServerName: string;
  bindDn: string;
  userBase: string;
  userFilter: string;
  subjectAttribute: string;
  emailAttribute: string;
  nameAttribute: string;
  groupAttribute: string;
  requiredGroup: string;
  groupRoles: { group: string; role: Role }[];
}

/** RFC 4515: characters that change the meaning of a search filter. */
export function escapeFilterValue(value: string): string {
  return value.replace(/[\\*()\0]/g, (c) => `\\${c.charCodeAt(0).toString(16).padStart(2, '0')}`);
}

const texts = (value: unknown): string[] =>
  (Array.isArray(value) ? value : value === undefined ? [] : [value]).map((v) =>
    Buffer.isBuffer(v) ? v.toString('utf8') : String(v),
  );

/** Directory identifiers such as objectGUID are binary; those become hex, text stays text. */
function subjectOf(value: unknown): string | null {
  const first: unknown = Array.isArray(value) ? value[0] : value;
  if (Buffer.isBuffer(first))
    return /^[\x20-\x7e]+$/.test(first.toString('latin1')) ? first.toString('latin1') : first.toString('hex');
  return typeof first === 'string' && first ? first : null;
}

const tlsOptionsFor = (c: LdapConfig) => ({
  rejectUnauthorized: true,
  minVersion: 'TLSv1.2' as const,
  ...(c.caCert ? { ca: c.caCert } : {}),
  ...(c.tlsServerName ? { servername: c.tlsServerName } : {}),
});

const clientFor = (c: LdapConfig): Client =>
  new Client({
    url: c.url,
    timeout: TIMEOUT_MS,
    connectTimeout: TIMEOUT_MS,
    strictDN: false,
    tlsOptions: tlsOptionsFor(c),
  });

/**
 * Signs a person in against the directory: find the entry with the service
 * account, then check the password by binding as that entry. The password is
 * never stored; accounts are linked like any other single sign-on identity.
 */
export async function ldapLogin(
  ctx: AppContext,
  providerId: string,
  username: string,
  password: string,
): Promise<Outcome> {
  // An empty password would be an unauthenticated bind, which many servers accept.
  if (!password || !username) return { error: 'denied' };
  return directorySignIn(ctx, await enabledProvider(ctx, providerId, 'ldap'), username, password);
}

/**
 * The same, for a person a trusted reverse proxy has already authenticated
 * (Kerberos): the directory only supplies the profile and the groups.
 */
export function directoryLookup(ctx: AppContext, row: Row, username: string): Promise<Outcome> {
  return directorySignIn(ctx, row, username, null);
}

async function directorySignIn(
  ctx: AppContext,
  row: Row,
  username: string,
  password: string | null,
): Promise<Outcome> {
  const c = row.config as unknown as LdapConfig;
  const client = clientFor(c);
  try {
    if (c.startTls) await client.startTLS(tlsOptionsFor(c));
    if (c.bindDn) {
      const bindPassword = row.secret ? ctx.box.open(row.secret, secretAad(row.id)) : '';
      await client.bind(c.bindDn, bindPassword);
    }
    const { searchEntries } = await client.search(c.userBase, {
      scope: 'sub',
      filter: c.userFilter.replaceAll('{username}', escapeFilterValue(username)),
      attributes: [c.subjectAttribute, c.emailAttribute, c.nameAttribute, c.groupAttribute],
      explicitBufferAttributes: [c.subjectAttribute],
      sizeLimit: 2,
    });
    // Zero hits: unknown name. Several hits: the filter is ambiguous, so nobody gets in.
    const [entry] = searchEntries;
    if (!entry || searchEntries.length !== 1) return { error: 'denied' };
    if (password !== null) {
      try {
        await client.bind(entry.dn, password);
      } catch (error) {
        if (error instanceof InvalidCredentialsError) return { error: 'denied' };
        throw error;
      }
    }
    const groups = texts(entry[c.groupAttribute]).map((g) => g.toLowerCase());
    if (c.requiredGroup && !groups.includes(c.requiredGroup.toLowerCase())) return { error: 'denied' };
    const subject = subjectOf(entry[c.subjectAttribute]);
    if (!subject) return { error: 'failed' };
    const outcome = await resolveUser(ctx, row, {
      subject,
      email: texts(entry[c.emailAttribute])[0] ?? null,
      emailVerified: false,
      name: texts(entry[c.nameAttribute])[0] ?? null,
      locale: null,
    });
    if ('userId' in outcome) await syncRoles(ctx, outcome.userId, row, c, groups);
    return outcome;
  } catch (error) {
    ctx.log.warn({ err: error, provider: row.id }, 'directory sign-in failed');
    return { error: 'failed' };
  } finally {
    await client.unbind().catch(() => undefined);
  }
}

/**
 * With group mappings configured, the directory decides the Coursecraft roles
 * at every sign-in. Administrator is never granted or removed here.
 */
async function syncRoles(
  ctx: AppContext,
  userId: string,
  row: Row,
  c: LdapConfig,
  groups: string[],
): Promise<void> {
  if (!c.groupRoles.length) return;
  const wanted = new Set<Role>([row.default_role]);
  for (const m of c.groupRoles) if (groups.includes(m.group.toLowerCase())) wanted.add(m.role);
  const stored = await ctx.db.selectFrom('user_roles').select('role').where('user_id', '=', userId).execute();
  const current = new Set(stored.map((r) => r.role).filter((r): r is Role => SSO_ROLES.some((x) => x === r)));
  const remove = [...current].filter((r) => !wanted.has(r));
  const add = [...wanted].filter((r) => !current.has(r));
  if (!remove.length && !add.length) return;
  await ctx.db.transaction().execute(async (tx) => {
    if (remove.length)
      await tx.deleteFrom('user_roles').where('user_id', '=', userId).where('role', 'in', remove).execute();
    if (add.length)
      await tx
        .insertInto('user_roles')
        .values(add.map((role) => ({ user_id: userId, role })))
        .execute();
    await ctx.audit.record(
      {
        actorUserId: userId,
        action: 'user.roles_synced',
        targetType: 'user',
        targetId: userId,
        meta: { provider: row.id, added: add, removed: remove },
      },
      tx,
    );
  });
  await ctx.sessions.markRotate(userId);
}
