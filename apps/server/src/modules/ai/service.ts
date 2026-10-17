// SPDX-License-Identifier: Apache-2.0
import type {
  AiPreview,
  AiPreviewRequest,
  AiProvider,
  AiProviderInput,
  AiRunResponse,
  AiStatus,
} from '@lernwerk/shared';
import type { AppContext, AuthState } from '../../http/context.js';
import { AppError, notFound } from '../../http/errors.js';
import { assertCourseEditor } from '../../policy/courses.js';
import { buildRequest, endpointFor, extractText, headersFor, parseResult, send } from './client.js';

const PREVIEW_MINUTES = 10;

const providerAad = (id: string) => `ai-provider:${id}`;
const userKeyAad = (userId: string, providerId: string) => `ai-user-key:${userId}:${providerId}`;
const last4 = (key: string) => key.slice(-4);
const today = () => new Date().toISOString().slice(0, 10);

/** Anthropic always needs a key; OpenAI-compatible local servers may run without one. */
const needsKey = (kind: AiProvider['kind']) => kind === 'anthropic';

function disabledByOperator(ctx: AppContext): void {
  if (!ctx.config.aiEnabled)
    throw new AppError('forbidden', 'The AI adapter is switched off by the operator');
}

export async function listProviders(
  ctx: AppContext,
): Promise<{ allowedByOperator: boolean; providers: AiProvider[] }> {
  const rows = await ctx.db.selectFrom('ai_providers').selectAll().orderBy('name').execute();
  return {
    allowedByOperator: ctx.config.aiEnabled,
    providers: rows.map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      baseUrl: r.base_url,
      model: r.model,
      enabled: r.enabled,
      allowUserKeys: r.allow_user_keys,
      dailyQuota: r.daily_quota,
      key: { set: r.api_key !== null, last4: r.api_key_last4 },
      updatedAt: r.updated_at.toISOString(),
    })),
  };
}

export async function saveProvider(
  ctx: AppContext,
  auth: AuthState,
  id: string | null,
  input: AiProviderInput,
): Promise<string> {
  disabledByOperator(ctx);
  const fields = {
    name: input.name,
    kind: input.kind,
    base_url: input.baseUrl.replace(/\/+$/, ''),
    model: input.model,
    enabled: input.enabled,
    allow_user_keys: input.allowUserKeys,
    daily_quota: input.dailyQuota,
  };
  const providerId = await ctx.db.transaction().execute(async (tx) => {
    let target = id;
    if (target) {
      const updated = await tx
        .updateTable('ai_providers')
        .set({ ...fields, updated_at: new Date() })
        .where('id', '=', target)
        .executeTakeFirst();
      if (!updated.numUpdatedRows) throw notFound('Provider not found');
    } else {
      target = (await tx.insertInto('ai_providers').values(fields).returning('id').executeTakeFirstOrThrow())
        .id;
    }
    if (input.key !== undefined) {
      await tx
        .updateTable('ai_providers')
        .set(
          input.key === null
            ? { api_key: null, api_key_last4: null }
            : {
                api_key: JSON.stringify(ctx.box.seal(input.key, providerAad(target))),
                api_key_last4: last4(input.key),
              },
        )
        .where('id', '=', target)
        .execute();
    }
    await ctx.audit.record(
      {
        actorUserId: auth.userId,
        action: id ? 'ai.provider_updated' : 'ai.provider_created',
        targetType: 'ai_provider',
        targetId: target,
        // The key itself is never logged; only whether it changed.
        meta: {
          kind: input.kind,
          baseUrl: fields.base_url,
          model: input.model,
          enabled: input.enabled,
          keyChanged: input.key !== undefined,
        },
      },
      tx,
    );
    return target;
  });
  return providerId;
}

export async function deleteProvider(ctx: AppContext, auth: AuthState, id: string): Promise<void> {
  const deleted = await ctx.db.deleteFrom('ai_providers').where('id', '=', id).executeTakeFirst();
  if (!deleted.numDeletedRows) throw notFound('Provider not found');
  await ctx.audit.record({
    actorUserId: auth.userId,
    action: 'ai.provider_deleted',
    targetType: 'ai_provider',
    targetId: id,
  });
}

export async function setUserKey(
  ctx: AppContext,
  auth: AuthState,
  providerId: string,
  key: string | null,
): Promise<void> {
  disabledByOperator(ctx);
  const provider = await ctx.db
    .selectFrom('ai_providers')
    .select(['allow_user_keys', 'enabled'])
    .where('id', '=', providerId)
    .executeTakeFirst();
  if (!provider?.enabled) throw notFound('Provider not found');
  if (key === null) {
    await ctx.db
      .deleteFrom('ai_user_keys')
      .where('user_id', '=', auth.userId)
      .where('provider_id', '=', providerId)
      .execute();
  } else {
    if (!provider.allow_user_keys)
      throw new AppError('forbidden', 'Personal keys are not allowed for this provider');
    const sealed = JSON.stringify(ctx.box.seal(key, userKeyAad(auth.userId, providerId)));
    await ctx.db
      .insertInto('ai_user_keys')
      .values({ user_id: auth.userId, provider_id: providerId, api_key: sealed, last4: last4(key) })
      .onConflict((oc) =>
        oc
          .columns(['user_id', 'provider_id'])
          .doUpdateSet({ api_key: sealed, last4: last4(key), updated_at: new Date() }),
      )
      .execute();
  }
  await ctx.audit.record({
    actorUserId: auth.userId,
    action: key === null ? 'ai.user_key_removed' : 'ai.user_key_set',
    targetType: 'ai_provider',
    targetId: providerId,
  });
}

/** Providers an author can use right now. Empty when the operator switch is off. */
export async function status(ctx: AppContext, auth: AuthState): Promise<AiStatus> {
  if (!ctx.config.aiEnabled) return { available: false, providers: [] };
  const rows = await ctx.db
    .selectFrom('ai_providers as p')
    .leftJoin('ai_user_keys as k', (j) =>
      j.onRef('k.provider_id', '=', 'p.id').on('k.user_id', '=', auth.userId),
    )
    .leftJoin('ai_usage as u', (j) =>
      j.onRef('u.provider_id', '=', 'p.id').on('u.user_id', '=', auth.userId).on('u.day', '=', today()),
    )
    .select([
      'p.id',
      'p.name',
      'p.kind',
      'p.model',
      'p.allow_user_keys',
      'p.daily_quota',
      'p.api_key_last4',
      'k.last4 as user_last4',
      'u.requests',
    ])
    .select((eb) => eb('p.api_key', 'is not', null).as('has_key'))
    .where('p.enabled', '=', true)
    .orderBy('p.name')
    .execute();
  const providers = rows.map((r) => {
    const userKey = r.allow_user_keys && r.user_last4 !== null;
    return {
      id: r.id,
      name: r.name,
      model: r.model,
      allowUserKeys: r.allow_user_keys,
      ready: userKey || Boolean(r.has_key) || !needsKey(r.kind),
      userKey: { set: userKey, last4: userKey ? r.user_last4 : null },
      remainingToday: r.daily_quota === null ? null : Math.max(0, r.daily_quota - (r.requests ?? 0)),
    };
  });
  return { available: providers.some((p) => p.ready), providers };
}

async function usableProvider(ctx: AppContext, auth: AuthState, providerId: string) {
  disabledByOperator(ctx);
  const provider = await ctx.db
    .selectFrom('ai_providers')
    .selectAll()
    .where('id', '=', providerId)
    .where('enabled', '=', true)
    .executeTakeFirst();
  if (!provider) throw notFound('Provider not found');
  const userKey = provider.allow_user_keys
    ? await ctx.db
        .selectFrom('ai_user_keys')
        .select('api_key')
        .where('user_id', '=', auth.userId)
        .where('provider_id', '=', providerId)
        .executeTakeFirst()
    : undefined;
  // A personal key wins over the shared one, so its owner pays for their own use.
  const key = userKey
    ? ctx.box.open(userKey.api_key, userKeyAad(auth.userId, providerId))
    : provider.api_key
      ? ctx.box.open(provider.api_key, providerAad(providerId))
      : null;
  if (!key && needsKey(provider.kind))
    throw new AppError('forbidden', 'No API key configured for this provider');
  return { provider, key };
}

/** Builds the exact request and stores it; nothing leaves the server yet. */
export async function preview(ctx: AppContext, auth: AuthState, input: AiPreviewRequest): Promise<AiPreview> {
  await assertCourseEditor(ctx.db, auth, input.courseId);
  const { provider } = await usableProvider(ctx, auth, input.providerId);
  const request = buildRequest(
    { kind: provider.kind, baseUrl: provider.base_url, model: provider.model },
    input,
  );
  const expiresAt = new Date(Date.now() + PREVIEW_MINUTES * 60_000);
  await ctx.db.deleteFrom('ai_previews').where('expires_at', '<', new Date()).execute();
  const row = await ctx.db
    .insertInto('ai_previews')
    .values({
      user_id: auth.userId,
      provider_id: provider.id,
      course_id: input.courseId,
      task: input.task,
      body: request.body,
      input_chars: input.text.length,
      expires_at: expiresAt,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return {
    previewId: row.id,
    provider: `${provider.name} (${provider.model})`,
    endpoint: request.endpoint,
    body: request.body,
    expiresAt: expiresAt.toISOString(),
  };
}

/** Counts the request against the daily quota; refuses when it is used up. */
async function consumeQuota(
  ctx: AppContext,
  auth: AuthState,
  providerId: string,
  quota: number | null,
): Promise<void> {
  const day = today();
  const row = await ctx.db
    .insertInto('ai_usage')
    .values({ user_id: auth.userId, provider_id: providerId, day, requests: 1 })
    .onConflict((oc) =>
      oc
        .columns(['user_id', 'provider_id', 'day'])
        .doUpdateSet((eb) => ({ requests: eb('ai_usage.requests', '+', 1) })),
    )
    .returning('requests')
    .executeTakeFirstOrThrow();
  if (quota !== null && row.requests > quota) {
    await ctx.db
      .updateTable('ai_usage')
      .set((eb) => ({ requests: eb('requests', '-', 1) }))
      .where('user_id', '=', auth.userId)
      .where('provider_id', '=', providerId)
      .where('day', '=', day)
      .execute();
    throw new AppError('quota_exceeded', 'Daily AI quota used up');
  }
}

/**
 * Sends a previewed request after the user confirmed it. The preview is
 * single-use and sent byte for byte; the result is an untrusted draft.
 */
export async function run(ctx: AppContext, auth: AuthState, previewId: string): Promise<AiRunResponse> {
  const stored = await ctx.db
    .deleteFrom('ai_previews')
    .where('id', '=', previewId)
    .where('user_id', '=', auth.userId)
    .where('expires_at', '>', new Date())
    .returningAll()
    .executeTakeFirst();
  if (!stored) throw notFound('Preview not found or expired');
  await assertCourseEditor(ctx.db, auth, stored.course_id);
  const { provider, key } = await usableProvider(ctx, auth, stored.provider_id);
  await consumeQuota(ctx, auth, provider.id, provider.daily_quota);
  const endpoint = endpointFor({ kind: provider.kind, baseUrl: provider.base_url, model: provider.model });
  const started = Date.now();
  let outcome: 'ok' | 'failed' = 'failed';
  let outputChars = 0;
  try {
    const json = await send(
      endpoint,
      headersFor(provider.kind, key),
      stored.body,
      ctx.config.aiTimeoutSeconds * 1000,
    );
    const text = extractText(provider.kind, json);
    outputChars = text.length;
    const result = parseResult(stored.task, text);
    outcome = 'ok';
    return result;
  } finally {
    // Metadata only: never prompts, course text or responses.
    await ctx.audit.record({
      actorUserId: auth.userId,
      action: 'ai.request',
      targetType: 'course',
      targetId: stored.course_id,
      meta: {
        provider: provider.id,
        model: provider.model,
        task: stored.task,
        inputChars: stored.input_chars,
        outputChars,
        durationMs: Date.now() - started,
        outcome,
      },
    });
  }
}
