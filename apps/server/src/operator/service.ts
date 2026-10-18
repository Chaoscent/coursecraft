// SPDX-License-Identifier: Apache-2.0
import type { OperatorTenant } from '@coursecraft/shared';
import type { BlobStore } from '@coursecraft/storage';
import type { Kysely } from 'kysely';
import { createHash, randomBytes } from 'node:crypto';
import { createTenant, deleteTenant, newSetupToken, newTenantSchema } from '../cli/tenants.js';
import { LATEST_MIGRATION } from '../db/migrations/index.js';
import type { Database } from '../db/schema.js';
import { AppError } from '../http/errors.js';
import { DEFAULT_TENANT_ID, runAsTenant } from '../tenancy/context.js';
import { usage } from '../tenancy/quotas.js';
import { StripeError, type StripeClient } from '../modules/billing/stripe.js';

export interface OperatorDeps {
  /** Owner of the tables (tenants, operator log). */
  migrator: Kysely<Database>;
  /** App role, inside one tenant at a time. */
  app: Kysely<Database>;
  blobs: BlobStore;
  /** Address of the installation (default organisation), for links; optional. */
  publicUrl?: string | undefined;
  release?: string | undefined;
  tenancy?: 'single' | 'multi' | undefined;
  storage?: 'fs' | 's3' | undefined;
  /** Stripe (optional billing); absent: no payment links. */
  stripe?: StripeClient | undefined;
}

const RESET_MINUTES = 60;
const inTenant = <T>(id: string, work: () => Promise<T>) =>
  runAsTenant({ id, publicOrigin: null, contentOrigin: null }, work);

/** Every change of the operator ends up here, with the organisation's name at that time. */
async function log(
  deps: OperatorDeps,
  action: string,
  tenantId: string | null,
  details: Record<string, unknown> | null = null,
): Promise<void> {
  const tenant = tenantId
    ? await deps.migrator.selectFrom('tenants').select('name').where('id', '=', tenantId).executeTakeFirst()
    : undefined;
  await deps.migrator
    .insertInto('operator_log')
    .values({
      action,
      tenant_id: tenantId,
      tenant_name: tenant?.name ?? null,
      details: details ? JSON.stringify(details) : null,
    })
    .execute();
}

export async function listTenants(deps: OperatorDeps): Promise<OperatorTenant[]> {
  const rows = await deps.migrator.selectFrom('tenants').selectAll().orderBy('created_at').execute();
  const items: OperatorTenant[] = [];
  for (const row of rows) {
    const used = await inTenant(row.id, () => usage({ db: deps.app }));
    items.push({
      id: row.id,
      name: row.name,
      publicOrigin: row.public_origin,
      contentOrigin: row.content_origin,
      status: row.status,
      isDefault: row.id === DEFAULT_TENANT_ID,
      maxUsers: row.max_users,
      maxStorageMb: row.max_storage_mb,
      contactName: row.contact_name,
      contactEmail: row.contact_email,
      plan: row.plan,
      notes: row.notes,
      planId: row.plan_id,
      billingState: row.billing_state,
      stripeCustomerId: row.stripe_customer_id,
      users: used.users,
      storageBytes: used.storageBytes,
      createdAt: row.created_at.toISOString(),
    });
  }
  return items;
}

async function assertTenant(deps: OperatorDeps, id: string) {
  const row = await deps.migrator.selectFrom('tenants').selectAll().where('id', '=', id).executeTakeFirst();
  if (!row) throw new AppError('not_found', 'Organisation not found');
  return row;
}

/** Usage figures and the administrators of one organisation (read with the app role, inside it). */
export async function tenantDetail(deps: OperatorDeps, id: string) {
  await assertTenant(deps, id);
  return inTenant(id, async () => {
    const db = deps.app;
    const since = new Date(Date.now() - 30 * 24 * 3_600_000);
    const count = async (query: Promise<{ n: string } | undefined>) => Number((await query)?.n ?? 0);
    const [used, active, courses, items, last, admins] = await Promise.all([
      usage({ db }),
      count(
        db
          .selectFrom('users')
          .select((eb) => eb.fn.countAll<string>().as('n'))
          .where('deleted_at', 'is', null)
          .where('last_login_at', '>=', since)
          .executeTakeFirst(),
      ),
      count(
        db
          .selectFrom('courses')
          .select((eb) => eb.fn.countAll<string>().as('n'))
          .executeTakeFirst(),
      ),
      count(
        db
          .selectFrom('library_items')
          .select((eb) => eb.fn.countAll<string>().as('n'))
          .executeTakeFirst(),
      ),
      db
        .selectFrom('users')
        .select((eb) => eb.fn.max('last_login_at').as('at'))
        .where('deleted_at', 'is', null)
        .executeTakeFirst(),
      db
        .selectFrom('users')
        .innerJoin('user_roles', 'user_roles.user_id', 'users.id')
        .select(['users.id', 'users.display_name', 'users.email', 'users.last_login_at'])
        .where('user_roles.role', '=', 'admin')
        .where('users.deleted_at', 'is', null)
        .orderBy('users.display_name')
        .execute(),
    ]);
    return {
      users: used.users,
      activeUsers30d: active,
      courses,
      libraryItems: items,
      storageBytes: used.storageBytes,
      lastSignInAt: last?.at ? new Date(last.at).toISOString() : null,
      admins: admins.map((a) => ({
        id: a.id,
        displayName: a.display_name,
        email: a.email,
        lastLoginAt: a.last_login_at?.toISOString() ?? null,
      })),
    };
  });
}

export async function addTenant(
  deps: OperatorDeps,
  input: {
    name: string;
    publicOrigin: string;
    contentOrigin: string;
    maxUsers: number | null;
    maxStorageMb: number | null;
  },
) {
  let created;
  try {
    created = await createTenant(deps.migrator, deps.app, input);
  } catch (error) {
    // Validation (origins) and duplicate addresses become a readable answer.
    const message = error instanceof Error ? error.message : 'Invalid input';
    throw new AppError(/duplicate key/.test(message) ? 'conflict' : 'bad_request', message.slice(0, 300));
  }
  await deps.migrator
    .updateTable('tenants')
    .set({ max_users: input.maxUsers, max_storage_mb: input.maxStorageMb })
    .where('id', '=', created.id)
    .execute();
  await log(deps, 'tenant.created', created.id, { publicOrigin: input.publicOrigin });
  return { id: created.id, token: created.token, expiresAt: created.expiresAt.toISOString() };
}

export async function updateTenant(
  deps: OperatorDeps,
  id: string,
  input: {
    name?: string | undefined;
    publicOrigin?: string | undefined;
    contentOrigin?: string | undefined;
    status?: 'active' | 'disabled' | undefined;
    maxUsers?: number | null | undefined;
    maxStorageMb?: number | null | undefined;
    contactName?: string | null | undefined;
    contactEmail?: string | null | undefined;
    plan?: string | null | undefined;
    notes?: string | null | undefined;
  },
): Promise<void> {
  const row = await assertTenant(deps, id);
  if (id === DEFAULT_TENANT_ID && input.status === 'disabled')
    throw new AppError('bad_request', 'The default organisation cannot be switched off');
  // Addresses: the same rules as when creating (https, origin only, two different ones).
  let origins: { public_origin?: string; content_origin?: string } = {};
  if (input.publicOrigin !== undefined || input.contentOrigin !== undefined) {
    if (id === DEFAULT_TENANT_ID)
      throw new AppError('bad_request', 'The default organisation uses the installation address');
    const parsed = newTenantSchema.safeParse({
      name: row.name,
      publicOrigin: input.publicOrigin ?? row.public_origin ?? '',
      contentOrigin: input.contentOrigin ?? row.content_origin ?? '',
    });
    if (!parsed.success)
      throw new AppError('bad_request', parsed.error.issues[0]?.message ?? 'Invalid address');
    origins = { public_origin: parsed.data.publicOrigin, content_origin: parsed.data.contentOrigin };
  }
  const blank = (v: string | null | undefined) => (v === undefined ? undefined : v?.trim() ? v.trim() : null);
  const values = {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...origins,
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.maxUsers !== undefined ? { max_users: input.maxUsers } : {}),
    ...(input.maxStorageMb !== undefined ? { max_storage_mb: input.maxStorageMb } : {}),
    ...(input.contactName !== undefined ? { contact_name: blank(input.contactName) ?? null } : {}),
    ...(input.contactEmail !== undefined ? { contact_email: blank(input.contactEmail) ?? null } : {}),
    ...(input.plan !== undefined ? { plan: blank(input.plan) ?? null } : {}),
    ...(input.notes !== undefined ? { notes: blank(input.notes) ?? null } : {}),
  };
  if (!Object.keys(values).length) return;
  try {
    await deps.migrator.updateTable('tenants').set(values).where('id', '=', id).execute();
  } catch (error) {
    if (error instanceof Error && /duplicate key/.test(error.message))
      throw new AppError('conflict', 'Another organisation already uses this address');
    throw error;
  }
  // The log keeps which fields changed, not their (possibly personal) values.
  await log(deps, 'tenant.updated', id, { fields: Object.keys(input) });
}

export async function setupToken(deps: OperatorDeps, id: string) {
  await assertTenant(deps, id);
  const setup = await newSetupToken(deps.app, id);
  if (!setup) throw new AppError('conflict', 'Setup of this organisation is already complete');
  await log(deps, 'tenant.setup_token', id);
  return { token: setup.token, expiresAt: setup.expiresAt.toISOString() };
}

/**
 * A password link for an administrator who locked themselves out. Shown once
 * to the operator, who hands it over; valid for an hour and once. Recorded in
 * the organisation's audit log as well.
 */
export async function adminResetLink(deps: OperatorDeps, tenantId: string, userId: string) {
  const tenant = await assertTenant(deps, tenantId);
  const base = tenant.public_origin ?? deps.publicUrl;
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + RESET_MINUTES * 60_000);
  await inTenant(tenantId, async () => {
    const admin = await deps.app
      .selectFrom('users')
      .innerJoin('user_roles', 'user_roles.user_id', 'users.id')
      .select('users.id')
      .where('users.id', '=', userId)
      .where('user_roles.role', '=', 'admin')
      .where('users.deleted_at', 'is', null)
      .executeTakeFirst();
    if (!admin) throw new AppError('not_found', 'Administrator not found');
    await deps.app.deleteFrom('password_resets').where('user_id', '=', userId).execute();
    await deps.app
      .insertInto('password_resets')
      .values({
        token_hash: createHash('sha256').update(token).digest('hex'),
        user_id: userId,
        expires_at: expiresAt,
      })
      .execute();
    await deps.app
      .insertInto('audit_log')
      .values({
        actor_user_id: null,
        action: 'operator.reset_link',
        target_type: 'user',
        target_id: userId,
        meta: JSON.stringify({}),
      })
      .execute();
  });
  await log(deps, 'tenant.admin_reset_link', tenantId, { userId });
  const path = `/reset-password#${token}`;
  return { link: base ? new URL(path, base).toString() : path, expiresAt: expiresAt.toISOString() };
}

export async function removeTenant(deps: OperatorDeps, id: string, confirmName: string): Promise<void> {
  const row = await assertTenant(deps, id);
  if (row.name !== confirmName) throw new AppError('bad_request', 'The name does not match');
  await log(deps, 'tenant.deleted', id);
  try {
    await deleteTenant(deps.migrator, deps.blobs, id);
  } catch (error) {
    throw new AppError('bad_request', error instanceof Error ? error.message : 'Cannot delete');
  }
}

export async function installation(deps: OperatorDeps) {
  const tenants = await listTenants(deps);
  return {
    version: deps.release ?? 'dev',
    tenancy: deps.tenancy ?? 'single',
    storage: deps.storage ?? 'fs',
    migration: LATEST_MIGRATION ?? '',
    organisations: tenants.length,
    activeOrganisations: tenants.filter((x) => x.status === 'active').length,
    users: tenants.reduce((n, x) => n + x.users, 0),
    storageBytes: tenants.reduce((n, x) => n + x.storageBytes, 0),
    billing: !!deps.stripe,
  };
}

export async function operatorLog(deps: OperatorDeps) {
  const rows = await deps.migrator
    .selectFrom('operator_log')
    .selectAll()
    .orderBy('id', 'desc')
    .limit(300)
    .execute();
  return {
    items: rows.map((r) => ({
      id: String(r.id),
      at: r.at.toISOString(),
      action: r.action,
      tenantName: r.tenant_name,
      details: r.details,
    })),
  };
}

/* ---------- Billing (optional, Stripe) ---------- */

const planOf = (r: {
  id: string;
  name: string;
  stripe_price_id: string;
  max_users: number | null;
  max_storage_mb: number | null;
}) => ({
  id: r.id,
  name: r.name,
  stripePriceId: r.stripe_price_id,
  maxUsers: r.max_users,
  maxStorageMb: r.max_storage_mb,
});

export async function listPlans(deps: OperatorDeps) {
  const rows = await deps.migrator.selectFrom('billing_plans').selectAll().orderBy('name').execute();
  return { items: rows.map(planOf) };
}

export async function savePlan(
  deps: OperatorDeps,
  id: string | null,
  input: { name: string; stripePriceId: string; maxUsers: number | null; maxStorageMb: number | null },
) {
  const values = {
    name: input.name,
    stripe_price_id: input.stripePriceId,
    max_users: input.maxUsers,
    max_storage_mb: input.maxStorageMb,
  };
  try {
    const row = id
      ? await deps.migrator
          .updateTable('billing_plans')
          .set(values)
          .where('id', '=', id)
          .returningAll()
          .executeTakeFirst()
      : await deps.migrator.insertInto('billing_plans').values(values).returningAll().executeTakeFirst();
    if (!row) throw new AppError('not_found', 'Plan not found');
    await log(deps, id ? 'plan.updated' : 'plan.created', null, { plan: input.name });
    return planOf(row);
  } catch (error) {
    if (error instanceof Error && /duplicate key/.test(error.message))
      throw new AppError('conflict', 'Another plan already uses this Stripe price');
    throw error;
  }
}

export async function deletePlan(deps: OperatorDeps, id: string): Promise<void> {
  const row = await deps.migrator
    .deleteFrom('billing_plans')
    .where('id', '=', id)
    .returning('name')
    .executeTakeFirst();
  if (!row) throw new AppError('not_found', 'Plan not found');
  await log(deps, 'plan.deleted', null, { plan: row.name });
}

function stripeOf(deps: OperatorDeps): StripeClient {
  if (!deps.stripe)
    throw new AppError('bad_request', 'Stripe is not configured (COURSECRAFT_STRIPE_SECRET_KEY)');
  return deps.stripe;
}

const stripeFailure = (error: unknown): never => {
  if (error instanceof StripeError)
    throw new AppError('upstream_failed', `Stripe: ${error.message}`.slice(0, 300));
  throw error;
};

/**
 * A Stripe payment page for one organisation and plan, to send to the
 * customer. The Stripe customer is created on first use and kept. The
 * organisation is switched on and gets the plan's limits by the webhook once
 * Stripe reports the payment, not here.
 */
export async function paymentLink(deps: OperatorDeps, tenantId: string, planId: string) {
  const stripe = stripeOf(deps);
  const tenant = await assertTenant(deps, tenantId);
  const plan = await deps.migrator
    .selectFrom('billing_plans')
    .selectAll()
    .where('id', '=', planId)
    .executeTakeFirst();
  if (!plan) throw new AppError('not_found', 'Plan not found');
  const base = tenant.public_origin ?? deps.publicUrl;
  if (!base) throw new AppError('bad_request', 'The organisation has no address to return to');
  try {
    let customer = tenant.stripe_customer_id;
    if (!customer) {
      customer = await stripe.createCustomer({ name: tenant.name, email: tenant.contact_email, tenantId });
      await deps.migrator
        .updateTable('tenants')
        .set({ stripe_customer_id: customer })
        .where('id', '=', tenantId)
        .execute();
    }
    const url = await stripe.createCheckout({
      customer,
      priceId: plan.stripe_price_id,
      tenantId,
      planId,
      successUrl: new URL('/?billing=success', base).toString(),
      cancelUrl: new URL('/?billing=canceled', base).toString(),
    });
    await log(deps, 'tenant.payment_link', tenantId, { plan: plan.name });
    return { url };
  } catch (error) {
    return stripeFailure(error);
  }
}

/** Stripe's customer portal for an organisation that already pays (payment method, invoices, cancel). */
export async function portalLink(deps: OperatorDeps, tenantId: string) {
  const stripe = stripeOf(deps);
  const tenant = await assertTenant(deps, tenantId);
  if (!tenant.stripe_customer_id)
    throw new AppError('bad_request', 'The organisation has no Stripe customer yet');
  const base = tenant.public_origin ?? deps.publicUrl;
  if (!base) throw new AppError('bad_request', 'The organisation has no address to return to');
  try {
    const url = await stripe.createPortal({
      customer: tenant.stripe_customer_id,
      returnUrl: new URL('/', base).toString(),
    });
    await log(deps, 'tenant.portal_link', tenantId);
    return { url };
  } catch (error) {
    return stripeFailure(error);
  }
}
