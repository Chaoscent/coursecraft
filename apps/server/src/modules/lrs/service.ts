// SPDX-License-Identifier: Apache-2.0
import { publicUrl } from '../../tenancy/origins.js';
import type { PackageKind } from '@coursecraft/shared';
import { createHash, randomUUID } from 'node:crypto';
import { hashToken, randomToken } from '../../crypto/tokens.js';
import type { AppContext } from '../../http/context.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../http/errors.js';
import type { PackageManifest } from '../library/manifest.js';
import { applyOutcome, fromStatement } from '../learning/projection.js';
import { agentKey } from '../learning/service.js';

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const MAX_STATEMENTS = 50;
const MAX_DOCUMENT_BYTES = 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A valid, unexpired launch, resolved from the token in the URL path. */
export interface Launch {
  id: string;
  registrationId: string;
  userId: string;
  packageId: string;
  kind: PackageKind;
  manifest: PackageManifest;
  mode: string;
  fetchUsed: boolean;
  actorKey: string;
}

export async function resolveLaunch(ctx: AppContext, token: string): Promise<Launch | null> {
  if (!TOKEN.test(token)) return null;
  const row = await ctx.db
    .selectFrom('launch_tokens')
    .innerJoin('packages', 'packages.id', 'launch_tokens.package_id')
    .select([
      'launch_tokens.id',
      'launch_tokens.registration_id',
      'launch_tokens.user_id',
      'launch_tokens.package_id',
      'launch_tokens.mode',
      'launch_tokens.fetch_used',
      'launch_tokens.expires_at',
      'launch_tokens.absolute_expires_at',
      'launch_tokens.revoked_at',
      'packages.kind',
      'packages.manifest',
    ])
    .where('launch_tokens.token_hash', '=', hashToken(token))
    .executeTakeFirst();
  const now = Date.now();
  if (!row || row.revoked_at || row.expires_at.getTime() < now || row.absolute_expires_at.getTime() < now)
    return null;
  return {
    id: row.id,
    registrationId: row.registration_id,
    userId: row.user_id,
    packageId: row.package_id,
    kind: row.kind,
    manifest: row.manifest as unknown as PackageManifest,
    mode: row.mode,
    fetchUsed: row.fetch_used,
    actorKey: `account:${publicUrl(ctx.config).origin}|${row.user_id}`,
  };
}

/** cmi5 fetch URL: hands out the auth token once per launch. */
export async function fetchAuthToken(ctx: AppContext, launch: Launch): Promise<Record<string, string>> {
  if (launch.fetchUsed) return { 'error-code': '1', 'error-text': 'The auth token was already retrieved' };
  await ctx.db.updateTable('launch_tokens').set({ fetch_used: true }).where('id', '=', launch.id).execute();
  return { 'auth-token': Buffer.from(`launch:${randomToken()}`).toString('base64') };
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

function canonical(statement: Json): string {
  const rest = { ...statement };
  delete rest['stored'];
  delete rest['authority'];
  delete rest['version'];
  return JSON.stringify(rest);
}

function checkStatement(launch: Launch, input: unknown, ctx: AppContext): Json {
  if (!isObject(input)) throw badRequest('Statement must be an object');
  const verb = input['verb'];
  if (!isObject(verb) || typeof verb['id'] !== 'string' || !/^[a-z][a-z0-9+.-]*:/i.test(verb['id']))
    throw badRequest('Statement needs a verb IRI');
  if (!isObject(input['object'])) throw badRequest('Statement needs an object');
  if (agentKey(input['actor']) !== launch.actorKey)
    throw forbidden('Statements only for the launched learner');
  const context = input['context'];
  if (context !== undefined && !isObject(context)) throw badRequest('Invalid context');
  const registration = isObject(context) ? context['registration'] : undefined;
  if (registration !== undefined && registration !== launch.registrationId)
    throw forbidden('Statements only for the launched registration');
  if (input['id'] !== undefined && (typeof input['id'] !== 'string' || !UUID.test(input['id'])))
    throw badRequest('Statement id must be a UUID');
  const now = new Date().toISOString();
  return {
    ...input,
    id: typeof input['id'] === 'string' ? input['id'].toLowerCase() : randomUUID(),
    timestamp: typeof input['timestamp'] === 'string' ? input['timestamp'] : now,
    stored: now,
    version: '1.0.3',
    authority: {
      objectType: 'Agent',
      name: 'Coursecraft',
      account: { homePage: publicUrl(ctx.config).origin, name: 'launch' },
    },
  };
}

/** Stores statements of the launched learner and projects them onto the registration. */
export async function storeStatements(ctx: AppContext, launch: Launch, body: unknown): Promise<string[]> {
  const list = Array.isArray(body) ? body : [body];
  if (!list.length || list.length > MAX_STATEMENTS)
    throw badRequest(`1 to ${MAX_STATEMENTS} statements per request`);
  const statements = list.map((s) => checkStatement(launch, s, ctx));
  const ids: string[] = [];
  for (const statement of statements) {
    const id = String(statement['id']);
    const existing = await ctx.db
      .selectFrom('lrs_statements')
      .select('statement')
      .where('id', '=', id)
      .executeTakeFirst();
    if (existing) {
      if (canonical(existing.statement) !== canonical(statement))
        throw conflict('A different statement has this id');
      ids.push(id);
      continue;
    }
    const verbId = String((statement['verb'] as Json)['id']);
    const object = statement['object'] as Json;
    await ctx.db
      .insertInto('lrs_statements')
      .values({
        id,
        statement: JSON.stringify(statement),
        actor_key: launch.actorKey,
        verb_id: verbId,
        activity_id: typeof object['id'] === 'string' ? object['id'].slice(0, 2000) : null,
        registration: launch.registrationId,
      })
      .execute();
    if (verbId === 'http://adlnet.gov/expapi/verbs/voided' && typeof object['id'] === 'string')
      await ctx.db
        .updateTable('lrs_statements')
        .set({ voided: true })
        .where('id', '=', object['id'])
        .where('registration', '=', launch.registrationId)
        .execute();
    // Browse and Review launches do not change results (cmi5 §10.2.2).
    else if (launch.mode === 'Normal') {
      const { outcome, response } = fromStatement(statement);
      await applyOutcome(ctx.db, launch.registrationId, outcome, response ? [response] : []);
    }
    ids.push(id);
  }
  return ids;
}

export async function getStatements(
  ctx: AppContext,
  launch: Launch,
  query: {
    statementId?: string | undefined;
    voidedStatementId?: string | undefined;
    limit?: number | undefined;
  },
): Promise<Json> {
  const id = query.statementId ?? query.voidedStatementId;
  if (id) {
    const row = await ctx.db
      .selectFrom('lrs_statements')
      .select(['statement', 'voided'])
      .where('id', '=', id.toLowerCase())
      .where('registration', '=', launch.registrationId)
      .executeTakeFirst();
    if (!row || row.voided !== Boolean(query.voidedStatementId)) throw notFound('Statement not found');
    return row.statement;
  }
  // Queries are limited to the launched registration.
  const rows = await ctx.db
    .selectFrom('lrs_statements')
    .select('statement')
    .where('registration', '=', launch.registrationId)
    .where('voided', '=', false)
    .orderBy('stored', 'desc')
    .limit(Math.min(500, query.limit || 500))
    .execute();
  return { statements: rows.map((r) => r.statement), more: '' };
}

export type DocumentKind = 'state' | 'activity_profile' | 'agent_profile';

export interface DocumentKey {
  kind: DocumentKind;
  activityId?: string | undefined;
  agent?: string | undefined;
  registration?: string | undefined;
  docId?: string | undefined;
}

function keyOf(launch: Launch, key: DocumentKey) {
  let agent = '';
  if (key.kind !== 'activity_profile') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(key.agent ?? '');
    } catch {
      throw badRequest('agent must be JSON');
    }
    agent = agentKey(parsed);
    if (agent !== launch.actorKey) throw forbidden('Documents only for the launched learner');
  }
  if (key.kind !== 'agent_profile' && !key.activityId) throw badRequest('activityId is required');
  if (key.registration && key.registration !== launch.registrationId) throw forbidden('Wrong registration');
  return {
    kind: key.kind,
    activity_id: key.kind === 'agent_profile' ? '' : (key.activityId ?? '').slice(0, 2000),
    agent_key: agent,
    registration: key.kind === 'state' ? (key.registration ?? '') : '',
  };
}

export async function getDocument(ctx: AppContext, launch: Launch, key: DocumentKey) {
  const k = keyOf(launch, key);
  if (!key.docId) {
    const rows = await ctx.db
      .selectFrom('lrs_documents')
      .select('doc_id')
      .where('kind', '=', k.kind)
      .where('activity_id', '=', k.activity_id)
      .where('agent_key', '=', k.agent_key)
      .where('registration', '=', k.registration)
      .execute();
    return { list: rows.map((r) => r.doc_id) };
  }
  const row = await ctx.db
    .selectFrom('lrs_documents')
    .select(['content', 'content_type', 'etag', 'updated_at'])
    .where('kind', '=', k.kind)
    .where('activity_id', '=', k.activity_id)
    .where('agent_key', '=', k.agent_key)
    .where('registration', '=', k.registration)
    .where('doc_id', '=', key.docId.slice(0, 500))
    .executeTakeFirst();
  if (!row) throw notFound('Document not found');
  return { document: row };
}

/** PUT replaces; POST merges JSON objects (xAPI 1.0.3 §2.2.6.3). */
export async function writeDocument(
  ctx: AppContext,
  launch: Launch,
  key: DocumentKey,
  body: Buffer,
  contentType: string,
  merge: boolean,
): Promise<void> {
  if (!key.docId) throw badRequest('Document id is required');
  if (body.length > MAX_DOCUMENT_BYTES) throw new AppError('payload_too_large', 'Document too large');
  const k = { ...keyOf(launch, key), doc_id: key.docId.slice(0, 500) };
  let content = body;
  let type = contentType || 'application/octet-stream';
  if (merge) {
    const existing = await ctx.db
      .selectFrom('lrs_documents')
      .select(['content', 'content_type'])
      .where('kind', '=', k.kind)
      .where('activity_id', '=', k.activity_id)
      .where('agent_key', '=', k.agent_key)
      .where('registration', '=', k.registration)
      .where('doc_id', '=', k.doc_id)
      .executeTakeFirst();
    let incoming: unknown;
    try {
      incoming = JSON.parse(body.toString('utf8'));
    } catch {
      throw badRequest('POST requires a JSON object');
    }
    if (!isObject(incoming)) throw badRequest('POST requires a JSON object');
    if (existing) {
      let current: unknown;
      try {
        current = JSON.parse(existing.content.toString('utf8'));
      } catch {
        throw badRequest('Stored document is not JSON');
      }
      if (!isObject(current)) throw badRequest('Stored document is not a JSON object');
      content = Buffer.from(JSON.stringify({ ...current, ...incoming }));
    }
    type = 'application/json';
  }
  const etag = createHash('sha1').update(content).digest('hex');
  await ctx.db
    .insertInto('lrs_documents')
    .values({ ...k, content, content_type: type.slice(0, 200), etag })
    .onConflict((oc) =>
      oc
        .constraint('lrs_documents_key')
        .doUpdateSet({ content, content_type: type.slice(0, 200), etag, updated_at: new Date() }),
    )
    .execute();
}

export async function deleteDocument(ctx: AppContext, launch: Launch, key: DocumentKey): Promise<void> {
  const k = keyOf(launch, key);
  let q = ctx.db
    .deleteFrom('lrs_documents')
    .where('kind', '=', k.kind)
    .where('activity_id', '=', k.activity_id)
    .where('agent_key', '=', k.agent_key)
    .where('registration', '=', k.registration);
  if (key.docId) q = q.where('doc_id', '=', key.docId.slice(0, 500));
  await q.execute();
}
