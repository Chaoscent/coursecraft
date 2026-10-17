// SPDX-License-Identifier: Apache-2.0
import type { LaunchResponse, MyItem, PackageKind } from '@coursecraft/shared';
import type { Kysely } from 'kysely';
import { hashToken, randomToken } from '../../crypto/tokens.js';
import type { Database } from '../../db/schema.js';
import type { AppContext, AuthState } from '../../http/context.js';
import { forbidden, notFound } from '../../http/errors.js';
import type { PackageManifest } from '../library/manifest.js';
import { assignedPathSteps, lockedItems, pathOf } from './paths.js';
import { applyOutcome, fromScorm, learningStatus } from './projection.js';

/** A launch stays valid for 15 minutes after the last heartbeat, 12 hours at most. */
export const LAUNCH_IDLE_MS = 15 * 60_000;
export const LAUNCH_ABSOLUTE_MS = 12 * 60 * 60_000;

/** Groups the user belongs to, plus their ancestors (assignments to a parent group include subgroups). */
export async function groupsWithAncestors(db: Kysely<Database>, userId: string): Promise<string[]> {
  const [groups, memberships] = await Promise.all([
    db.selectFrom('groups').select(['id', 'parent_id']).execute(),
    db.selectFrom('group_members').select('group_id').where('user_id', '=', userId).execute(),
  ]);
  const parent = new Map(groups.map((g) => [g.id, g.parent_id]));
  const out = new Set<string>();
  for (const { group_id } of memberships) {
    let current: string | null | undefined = group_id;
    while (current && !out.has(current)) {
      out.add(current);
      current = parent.get(current);
    }
  }
  return [...out];
}

/** Library items assigned to the user (directly or through groups), with the earliest due date. */
async function assignedItems(db: Kysely<Database>, userId: string) {
  const groups = await groupsWithAncestors(db, userId);
  const steps = await assignedPathSteps(db, userId, groups);
  const rows = await db
    .selectFrom('assignments')
    .innerJoin('library_items', 'library_items.id', 'assignments.library_item_id')
    .innerJoin('packages', 'packages.id', 'library_items.package_id')
    .select([
      'library_items.id',
      'library_items.title',
      'library_items.description',
      'packages.kind',
      'assignments.due_at',
    ])
    .where('library_items.status', '=', 'active')
    .where((eb) =>
      eb.or([
        eb('assignments.user_id', '=', userId),
        ...(groups.length ? [eb('assignments.group_id', 'in', groups)] : []),
      ]),
    )
    .execute();
  const items = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const known = items.get(row.id);
    if (!known || (row.due_at && (!known.due_at || row.due_at < known.due_at))) items.set(row.id, row);
  }
  const direct = new Set(items.keys());
  // Courses of assigned paths: the path's due date counts like an assignment's.
  const viaPath = [...new Set(steps.map((s) => s.itemId))];
  if (viaPath.length) {
    const extra = await db
      .selectFrom('library_items')
      .innerJoin('packages', 'packages.id', 'library_items.package_id')
      .select(['library_items.id', 'library_items.title', 'library_items.description', 'packages.kind'])
      .where('library_items.id', 'in', viaPath)
      .where('library_items.status', '=', 'active')
      .execute();
    for (const e of extra) {
      const due = steps
        .filter((s) => s.itemId === e.id)
        .reduce<Date | null>((min, s) => (s.dueAt && (!min || s.dueAt < min) ? s.dueAt : min), null);
      const known = items.get(e.id);
      if (!known) items.set(e.id, { ...e, due_at: due });
      else if (due && (!known.due_at || due < known.due_at)) items.set(e.id, { ...known, due_at: due });
    }
  }
  return { items, direct, steps };
}

async function latestRegistration(db: Kysely<Database>, userId: string, itemId: string) {
  return db
    .selectFrom('registrations')
    .selectAll()
    .where('user_id', '=', userId)
    .where('library_item_id', '=', itemId)
    .orderBy('attempt', 'desc')
    .limit(1)
    .executeTakeFirst();
}

export async function myItems(ctx: AppContext, auth: AuthState): Promise<MyItem[]> {
  const { items, direct, steps } = await assignedItems(ctx.db, auth.userId);
  const locked = await lockedItems(ctx.db, auth.userId, steps, direct);
  const out: MyItem[] = [];
  for (const item of items.values()) {
    const reg = await latestRegistration(ctx.db, auth.userId, item.id);
    const status = learningStatus(reg);
    out.push({
      id: item.id,
      title: item.title,
      description: item.description,
      kind: item.kind,
      dueAt: item.due_at?.toISOString() ?? null,
      overdue:
        !!item.due_at && item.due_at.getTime() < Date.now() && status !== 'completed' && status !== 'passed',
      status,
      scoreScaled: reg?.score_scaled ?? null,
      attempt: reg?.attempt ?? 0,
      lastActivityAt: reg?.last_activity_at.toISOString() ?? null,
      path: pathOf(steps, item.id),
      locked: locked.has(item.id),
    });
  }
  return out.sort(
    (a, b) => (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999') || a.title.localeCompare(b.title),
  );
}

function actorFor(ctx: AppContext, auth: AuthState) {
  return {
    objectType: 'Agent',
    name: auth.displayName,
    account: { homePage: ctx.config.publicUrl.origin, name: auth.userId },
  };
}

/** Comparable key for an xAPI agent (account or mbox). */
export function agentKey(agent: unknown): string {
  const a = typeof agent === 'object' && agent !== null ? (agent as Record<string, unknown>) : {};
  const account =
    typeof a['account'] === 'object' && a['account'] !== null
      ? (a['account'] as Record<string, unknown>)
      : null;
  if (account) return `account:${String(account['homePage'])}|${String(account['name'])}`;
  if (typeof a['mbox'] === 'string') return `mbox:${a['mbox']}`;
  if (typeof a['mbox_sha1sum'] === 'string') return `sha1:${a['mbox_sha1sum']}`;
  if (typeof a['openid'] === 'string') return `openid:${a['openid']}`;
  return '';
}

function contentBase(ctx: AppContext): string {
  return (ctx.config.contentUrl ?? ctx.config.publicUrl).origin;
}

/**
 * Starts or resumes the learner's attempt and issues a launch token. Only
 * items assigned to the user can be launched; others are "not found".
 */
export async function launch(
  ctx: AppContext,
  auth: AuthState,
  itemId: string,
  newAttempt: boolean,
): Promise<LaunchResponse> {
  const assigned = await assignedItems(ctx.db, auth.userId);
  const item = assigned.items.get(itemId);
  if (!item) throw notFound('Item not found');
  if ((await lockedItems(ctx.db, auth.userId, assigned.steps, assigned.direct)).has(itemId))
    throw forbidden('Complete the earlier steps of the path first');
  const current = await ctx.db
    .selectFrom('library_items')
    .select('package_id')
    .where('id', '=', itemId)
    .executeTakeFirstOrThrow();
  let reg = await latestRegistration(ctx.db, auth.userId, itemId);
  if (!reg || newAttempt) {
    reg = await ctx.db
      .insertInto('registrations')
      .values({
        user_id: auth.userId,
        library_item_id: itemId,
        package_id: current.package_id,
        attempt: (reg?.attempt ?? 0) + 1,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }
  const pkg = await ctx.db
    .selectFrom('packages')
    .select(['id', 'kind', 'launch_path', 'manifest', 'title'])
    .where('id', '=', reg.package_id)
    .executeTakeFirstOrThrow();
  const manifest = pkg.manifest as unknown as PackageManifest;

  const token = randomToken();
  const now = Date.now();
  const mode = reg.completion === 'completed' && !newAttempt ? 'Review' : 'Normal';
  const launchRow = await ctx.db
    .insertInto('launch_tokens')
    .values({
      token_hash: hashToken(token),
      registration_id: reg.id,
      user_id: auth.userId,
      session_id: auth.sessionId,
      package_id: pkg.id,
      mode,
      expires_at: new Date(now + LAUNCH_IDLE_MS),
      absolute_expires_at: new Date(now + LAUNCH_ABSOLUTE_MS),
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  const base = `${contentBase(ctx)}/launch/${token}`;
  const actor = actorFor(ctx, auth);
  const kind: PackageKind = pkg.kind;
  let url: string;
  let cmi: Record<string, unknown> | null = null;
  if (kind === 'scorm12' || kind === 'scorm2004') {
    const stored = await ctx.db
      .selectFrom('scorm_runtime')
      .select('cmi')
      .where('registration_id', '=', reg.id)
      .executeTakeFirst();
    cmi = stored?.cmi ?? {};
    url = `${base}/_lw/wrapper.html`;
  } else {
    const activityId = manifest.activityId ?? `urn:coursecraft:package:${pkg.id}`;
    const query = new URLSearchParams({
      endpoint: `${base}/xapi/`,
      actor: JSON.stringify(actor),
      registration: reg.id,
      activityId,
    });
    if (kind === 'xapi') {
      query.delete('activityId');
      query.set('activity_id', activityId);
      query.set('auth', `Basic ${Buffer.from(`launch:${token}`).toString('base64')}`);
    } else {
      query.set('fetch', `${base}/fetch`);
      await writeLaunchData(ctx, reg.id, activityId, actor, manifest, mode);
    }
    const extra = manifest.launchQuery ? `&${manifest.launchQuery}` : '';
    url = `${base}/${pkg.launch_path.split('/').map(encodeURIComponent).join('/')}?${query.toString()}${extra}`;
  }
  await ctx.db
    .updateTable('registrations')
    .set({
      last_activity_at: new Date(),
      ...(reg.completion === 'unknown' ? { completion: 'incomplete' } : {}),
    })
    .where('id', '=', reg.id)
    .execute();
  return {
    launchId: launchRow.id,
    registrationId: reg.id,
    kind,
    url,
    contentOrigin: contentBase(ctx),
    cmi,
    scorm:
      kind === 'scorm12' || kind === 'scorm2004'
        ? {
            launchPath: `${pkg.launch_path.split('/').map(encodeURIComponent).join('/')}${manifest.launchQuery ? `?${manifest.launchQuery}` : ''}`,
            mode: mode === 'Review' ? 'Review' : 'Normal',
            learnerId: auth.userId,
            learnerName: auth.displayName,
          }
        : null,
    title: item.title,
  };
}

/** cmi5 requires LMS.LaunchData in the State API before the AU starts. */
async function writeLaunchData(
  ctx: AppContext,
  registration: string,
  activityId: string,
  actor: Record<string, unknown>,
  manifest: PackageManifest,
  mode: string,
): Promise<void> {
  const content = Buffer.from(
    JSON.stringify({
      contextTemplate: {
        contextActivities: { grouping: [{ id: activityId, objectType: 'Activity' }] },
        extensions: { 'https://w3id.org/xapi/cmi5/context/extensions/sessionid': registration },
      },
      launchMode: mode,
      launchMethod: 'AnyWindow',
      moveOn: manifest.moveOn ?? 'Completed',
      ...(manifest.masteryScore !== null ? { masteryScore: manifest.masteryScore } : {}),
    }),
  );
  const key = {
    kind: 'state' as const,
    activity_id: activityId,
    agent_key: agentKey(actor),
    registration,
    doc_id: 'LMS.LaunchData',
  };
  await ctx.db
    .insertInto('lrs_documents')
    .values({
      ...key,
      content,
      content_type: 'application/json',
      etag: hashToken(content.toString('base64')),
    })
    .onConflict((oc) =>
      oc
        .columns(['kind', 'activity_id', 'agent_key', 'registration', 'doc_id'])
        .doUpdateSet({ content, updated_at: new Date(), etag: hashToken(content.toString('base64')) }),
    )
    .execute();
}

async function ownLaunch(ctx: AppContext, auth: AuthState, launchId: string) {
  const row = await ctx.db
    .selectFrom('launch_tokens')
    .innerJoin('registrations', 'registrations.id', 'launch_tokens.registration_id')
    .innerJoin('packages', 'packages.id', 'launch_tokens.package_id')
    .select([
      'launch_tokens.id',
      'launch_tokens.registration_id',
      'launch_tokens.absolute_expires_at',
      'launch_tokens.revoked_at',
      'launch_tokens.mode',
      'packages.kind',
      'packages.manifest',
    ])
    .where('launch_tokens.id', '=', launchId)
    .where('launch_tokens.user_id', '=', auth.userId)
    .executeTakeFirst();
  if (!row || row.revoked_at) throw notFound('Launch not found');
  return row;
}

/** Keeps the launch token alive while the player page is open. */
export async function heartbeat(ctx: AppContext, auth: AuthState, launchId: string): Promise<void> {
  const row = await ownLaunch(ctx, auth, launchId);
  const next = Math.min(Date.now() + LAUNCH_IDLE_MS, row.absolute_expires_at.getTime());
  await ctx.db
    .updateTable('launch_tokens')
    .set({ expires_at: new Date(next) })
    .where('id', '=', launchId)
    .execute();
}

export async function endLaunch(ctx: AppContext, auth: AuthState, launchId: string): Promise<void> {
  await ownLaunch(ctx, auth, launchId);
  await ctx.db
    .updateTable('launch_tokens')
    .set({ revoked_at: new Date() })
    .where('id', '=', launchId)
    .execute();
}

/** Stores SCORM runtime data sent by the host page and updates the projection. */
export async function scormCommit(
  ctx: AppContext,
  auth: AuthState,
  launchId: string,
  cmi: Record<string, unknown>,
  finished: boolean,
): Promise<void> {
  const row = await ownLaunch(ctx, auth, launchId);
  if (row.kind !== 'scorm12' && row.kind !== 'scorm2004') throw notFound('Launch not found');
  // Review mode must not change results.
  if (row.mode === 'Review') return;
  await ctx.db
    .insertInto('scorm_runtime')
    .values({ registration_id: row.registration_id, cmi: JSON.stringify(cmi) })
    .onConflict((oc) =>
      oc.column('registration_id').doUpdateSet({ cmi: JSON.stringify(cmi), updated_at: new Date() }),
    )
    .execute();
  const manifest = row.manifest as unknown as PackageManifest;
  const { outcome, responses } = fromScorm(row.kind, cmi, { masteryScore: manifest.masteryScore, finished });
  await applyOutcome(ctx.db, row.registration_id, outcome, responses);
}
