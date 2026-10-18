// SPDX-License-Identifier: Apache-2.0
import { publicUrl } from '../../tenancy/origins.js';
import { QUEUES, type MailJob, type SmtpSettings, type SmtpSettingsInput } from '@coursecraft/shared';
import nodemailer from 'nodemailer';
import { z } from 'zod';
import type { SealedJson } from '../../db/schema.js';
import type { AppContext, AuthState } from '../../http/context.js';
import { AppError } from '../../http/errors.js';
import { formatDue, renderMail } from './templates.js';

const SETTINGS_KEY = 'smtp';
const PASSWORD_AAD = 'smtp-password';
const REMINDER_HOURS = 72;

const storedSchema = z.object({
  enabled: z.boolean(),
  host: z.string(),
  port: z.number().int(),
  security: z.enum(['tls', 'starttls', 'none']),
  username: z.string(),
  password: z.object({ ciphertext: z.string(), nonce: z.string(), keyVersion: z.number() }).nullable(),
  from: z.string(),
});
type Stored = z.infer<typeof storedSchema>;

async function loadStored(ctx: AppContext): Promise<{ value: Stored; updatedAt: Date } | null> {
  const row = await ctx.db
    .selectFrom('settings')
    .select(['value', 'updated_at'])
    .where('key', '=', SETTINGS_KEY)
    .executeTakeFirst();
  if (!row) return null;
  const parsed = storedSchema.safeParse(row.value);
  return parsed.success ? { value: parsed.data, updatedAt: row.updated_at } : null;
}

export async function getSmtpSettings(ctx: AppContext): Promise<SmtpSettings> {
  const stored = await loadStored(ctx);
  if (!stored) {
    return {
      enabled: false,
      host: '',
      port: 587,
      security: 'starttls',
      username: '',
      password: { set: false },
      from: '',
      updatedAt: null,
    };
  }
  const { password, ...rest } = stored.value;
  return { ...rest, password: { set: password !== null }, updatedAt: stored.updatedAt.toISOString() };
}

export async function saveSmtpSettings(
  ctx: AppContext,
  auth: AuthState,
  input: SmtpSettingsInput,
): Promise<void> {
  const current = await loadStored(ctx);
  const password: SealedJson | null =
    input.password === undefined
      ? (current?.value.password ?? null)
      : input.password === null || input.password === ''
        ? null
        : ctx.box.seal(input.password, PASSWORD_AAD);
  const value: Stored = {
    enabled: input.enabled,
    host: input.host,
    port: input.port,
    security: input.security,
    username: input.username,
    password,
    from: input.from,
  };
  await ctx.db
    .insertInto('settings')
    .values({ key: SETTINGS_KEY, value: JSON.stringify(value) })
    .onConflict((oc) =>
      oc.constraint('settings_pkey').doUpdateSet({ value: JSON.stringify(value), updated_at: new Date() }),
    )
    .execute();
  await ctx.audit.record({
    actorUserId: auth.userId,
    action: 'settings.smtp_updated',
    targetType: 'settings',
    targetId: SETTINGS_KEY,
    meta: {
      enabled: input.enabled,
      host: input.host,
      port: input.port,
      passwordChanged: input.password !== undefined,
    },
  });
}

/** Whether mails can be sent at all; callers skip queueing otherwise. */
export async function mailEnabled(ctx: AppContext): Promise<boolean> {
  return (await loadStored(ctx))?.value.enabled ?? false;
}

/** The only path to the SMTP server (outbound connection configured by an administrator). */
async function deliver(ctx: AppContext, to: string, mail: { subject: string; text: string }): Promise<void> {
  const stored = await loadStored(ctx);
  if (!stored?.value.enabled) throw new AppError('bad_request', 'E-mail is not set up');
  const s = stored.value;
  const transport = nodemailer.createTransport({
    host: s.host,
    port: s.port,
    secure: s.security === 'tls',
    requireTLS: s.security === 'starttls',
    ignoreTLS: s.security === 'none',
    ...(s.username
      ? { auth: { user: s.username, pass: s.password ? ctx.box.open(s.password, PASSWORD_AAD) : '' } }
      : {}),
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
  try {
    await transport.sendMail({ from: s.from, to, subject: mail.subject, text: mail.text });
  } finally {
    transport.close();
  }
}

/** Sends a test mail to the administrator, synchronously, so errors show in the UI. */
export async function sendTestMail(ctx: AppContext, auth: AuthState): Promise<void> {
  try {
    await deliver(ctx, auth.email, renderMail('test', auth.locale));
  } catch (error) {
    if (error instanceof AppError) throw error;
    ctx.log.warn({ err: error }, 'test mail failed');
    throw new AppError('upstream_failed', 'The mail server did not accept the message');
  }
}

/** Queues one mail; recipients are resolved and texts rendered when the job runs. */
export async function queueMail(ctx: AppContext, job: MailJob): Promise<void> {
  await ctx.jobs.send(QUEUES.mail, job, { expireInSeconds: 3600 });
}

/** Job handler: active users only, in their own language. */
export async function handleMailJob(ctx: AppContext, job: MailJob): Promise<void> {
  const user = await ctx.db
    .selectFrom('users')
    .select(['email', 'display_name', 'locale', 'status'])
    .where('id', '=', job.userId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!user || user.status !== 'active') return;
  const params: Record<string, string> = { ...job.params, name: user.display_name };
  if (job.kind === 'passwordReset') {
    const sealed = JSON.parse(job.params['token'] ?? 'null') as SealedJson | null;
    if (!sealed) return;
    const token = ctx.box.open(sealed, `password-reset:${job.userId}`);
    params['link'] = new URL(`/reset-password#${token}`, publicUrl(ctx.config)).toString();
    delete params['token'];
  }
  if (params['dueAt']) params['due'] = formatDue(new Date(params['dueAt']), user.locale, ctx.config.timeZone);
  await deliver(ctx, user.email, renderMail(job.kind, user.locale, params));
}

/** Members of a group and of all its subgroups. */
async function groupMembers(ctx: AppContext, groupId: string): Promise<string[]> {
  const groups = await ctx.db.selectFrom('groups').select(['id', 'parent_id']).execute();
  const ids = new Set([groupId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const g of groups) {
      if (g.parent_id && ids.has(g.parent_id) && !ids.has(g.id)) {
        ids.add(g.id);
        grew = true;
      }
    }
  }
  const members = await ctx.db
    .selectFrom('group_members')
    .select('user_id')
    .where('group_id', 'in', [...ids])
    .execute();
  return [...new Set(members.map((m) => m.user_id))];
}

async function recipients(ctx: AppContext, assignment: { user_id: string | null; group_id: string | null }) {
  if (assignment.user_id) return [assignment.user_id];
  return assignment.group_id ? groupMembers(ctx, assignment.group_id) : [];
}

/** Records the notice; only the first caller (also across app instances) gets true. */
async function claimNotice(
  ctx: AppContext,
  assignmentId: string,
  userId: string,
  kind: 'assigned' | 'reminder',
) {
  const row = await ctx.db
    .insertInto('assignment_notices')
    .values({ assignment_id: assignmentId, user_id: userId, kind })
    .onConflict((oc) => oc.doNothing())
    .returning('user_id')
    .executeTakeFirst();
  return !!row;
}

const learnLink = (ctx: AppContext) => new URL('/', publicUrl(ctx.config)).toString();

/** "You have a new course" for every learner of the given assignments, once each. */
export async function notifyAssigned(ctx: AppContext, assignmentIds: string[]): Promise<number> {
  if (!assignmentIds.length || !(await mailEnabled(ctx))) return 0;
  const rows = await ctx.db
    .selectFrom('assignments')
    .innerJoin('library_items', 'library_items.id', 'assignments.library_item_id')
    .select([
      'assignments.id',
      'assignments.user_id',
      'assignments.group_id',
      'assignments.due_at',
      'library_items.title',
    ])
    .where('assignments.id', 'in', assignmentIds)
    .execute();
  let queued = 0;
  for (const a of rows) {
    for (const userId of await recipients(ctx, a)) {
      if (!(await claimNotice(ctx, a.id, userId, 'assigned'))) continue;
      await queueMail(ctx, {
        kind: 'assigned',
        userId,
        params: {
          title: a.title,
          link: learnLink(ctx),
          ...(a.due_at ? { dueAt: a.due_at.toISOString() } : {}),
        },
      });
      queued += 1;
    }
  }
  return queued;
}

/** Reminders for assignments due within the next days and not completed; once per learner. */
export async function sendDueReminders(ctx: AppContext, now = new Date()): Promise<number> {
  if (!(await mailEnabled(ctx))) return 0;
  const until = new Date(now.getTime() + REMINDER_HOURS * 3_600_000);
  const due = await ctx.db
    .selectFrom('assignments')
    .innerJoin('library_items', 'library_items.id', 'assignments.library_item_id')
    .select([
      'assignments.id',
      'assignments.user_id',
      'assignments.group_id',
      'assignments.due_at',
      'assignments.library_item_id',
      'library_items.title',
    ])
    .where('library_items.status', '=', 'active')
    .where('assignments.due_at', '>', now)
    .where('assignments.due_at', '<=', until)
    .execute();
  let queued = 0;
  for (const a of due) {
    const users = await recipients(ctx, a);
    if (!users.length) continue;
    const done = new Set(
      (
        await ctx.db
          .selectFrom('registrations')
          .select('user_id')
          .where('library_item_id', '=', a.library_item_id)
          .where('user_id', 'in', users)
          .where('completion', '=', 'completed')
          .execute()
      ).map((r) => r.user_id),
    );
    for (const userId of users) {
      if (done.has(userId) || !(await claimNotice(ctx, a.id, userId, 'reminder'))) continue;
      await queueMail(ctx, {
        kind: 'reminder',
        userId,
        params: { title: a.title, link: learnLink(ctx), dueAt: a.due_at?.toISOString() ?? '' },
      });
      queued += 1;
    }
  }
  return queued;
}
