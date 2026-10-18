// SPDX-License-Identifier: Apache-2.0
// Optional Stripe billing: plans and payment links (operator), events (app webhook).
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../../apps/server/src/db/connection.js';
import {
  signStripePayload,
  StripeClient,
  verifyStripeEvent,
} from '../../apps/server/src/modules/billing/stripe.js';
import { buildOperatorApp } from '../../apps/server/src/operator/app.js';
import { DEFAULT_TENANT_ID } from '../../apps/server/src/tenancy/context.js';
import { FakeStripe } from '../support/stripe-fake.js';
import { createTestApp, type TestApp } from '../support/test-app.js';

const WEBHOOK_SECRET = 'whsec_test_0123456789';
const PASSWORD = 'operator password for billing tests';
const stripe = new FakeStripe();
let t: TestApp;
let op: FastifyInstance;
let dbs: ReturnType<typeof createDatabase>[];
let cookie = '';
let csrf = '';
let tenantId = '';
let planId = '';

beforeAll(async () => {
  await stripe.start();
  t = await createTestApp({ COURSECRAFT_STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET });
  const migrator = createDatabase(t.migratorUrl, { max: 1 });
  const app = createDatabase(t.databaseUrl, { max: 1, tenancy: 'multi' });
  dbs = [migrator, app];
  op = await buildOperatorApp(
    {
      migratorDatabaseUrl: t.migratorUrl,
      databaseUrl: t.databaseUrl,
      password: PASSWORD,
      host: '127.0.0.1',
      port: 0,
      webDir: '/nonexistent',
      logLevel: 'fatal',
      release: 'test',
      tenancy: 'multi',
      storage: 'fs',
    },
    {
      migrator,
      app,
      blobs: t.ctx.blobs,
      publicUrl: 'https://coursecraft.test',
      stripe: new StripeClient(stripe.key, stripe.base),
    },
  );
  const login = await call('POST', '/api/operator/login', { password: PASSWORD });
  cookie = login.cookies.find((c) => c.name === '__Host-cc_operator')?.value ?? '';
  csrf = login.json<{ csrfToken: string }>().csrfToken;
});
afterAll(async () => {
  await op.close();
  for (const db of dbs) await db.destroy();
  await t.close();
  await stripe.stop();
});

function call(method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, body?: unknown) {
  return op.inject({
    method,
    url,
    headers: {
      host: 'localhost:3002',
      origin: 'http://localhost:3002',
      ...(csrf ? { 'x-csrf-token': csrf } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(cookie ? { cookies: { '__Host-cc_operator': cookie } } : {}),
    ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
  });
}

let eventNo = 0;
function webhook(
  type: string,
  object: Record<string, unknown>,
  options: { id?: string; secret?: string } = {},
) {
  const body = JSON.stringify({ id: options.id ?? `evt_${++eventNo}`, type, data: { object } });
  return t.app.inject({
    method: 'POST',
    url: '/api/billing/stripe/webhook',
    headers: {
      'content-type': 'application/json',
      'stripe-signature': signStripePayload(body, options.secret ?? WEBHOOK_SECRET),
    },
    payload: body,
  });
}

const tenant = () =>
  t.ctx.db
    .selectFrom('tenants')
    .select(['status', 'plan', 'max_users', 'max_storage_mb', 'billing_state', 'stripe_customer_id'])
    .where('id', '=', tenantId)
    .executeTakeFirstOrThrow();

describe('webhook signatures', () => {
  it('accepts only Stripe-signed, recent, unchanged payloads', () => {
    const body = JSON.stringify({ id: 'evt_x', type: 'ping', data: { object: {} } });
    const raw = Buffer.from(body);
    expect(verifyStripeEvent(raw, signStripePayload(body, WEBHOOK_SECRET), WEBHOOK_SECRET)?.id).toBe('evt_x');
    expect(verifyStripeEvent(raw, signStripePayload(body, 'whsec_other_0000000'), WEBHOOK_SECRET)).toBeNull();
    expect(
      verifyStripeEvent(Buffer.from(`${body} `), signStripePayload(body, WEBHOOK_SECRET), WEBHOOK_SECRET),
    ).toBeNull();
    const old = Math.floor(Date.now() / 1000) - 3600;
    expect(verifyStripeEvent(raw, signStripePayload(body, WEBHOOK_SECRET, old), WEBHOOK_SECRET)).toBeNull();
    expect(verifyStripeEvent(raw, undefined, WEBHOOK_SECRET)).toBeNull();
  });
});

describe('Stripe billing', () => {
  it('refuses plans and payment links without an operator session', async () => {
    const id = DEFAULT_TENANT_ID;
    for (const [method, url] of [
      ['GET', '/api/operator/plans'],
      ['POST', '/api/operator/plans'],
      ['PUT', `/api/operator/plans/${id}`],
      ['POST', `/api/operator/plans/${id}/delete`],
      ['POST', `/api/operator/tenants/${id}/payment-link`],
      ['POST', `/api/operator/tenants/${id}/portal-link`],
    ] as const) {
      const res = await op.inject({
        method,
        url,
        headers: {
          host: 'localhost:3002',
          origin: 'http://localhost:3002',
          'content-type': 'application/json',
        },
        ...(method === 'GET' ? {} : { payload: '{}' }),
      });
      expect(res.statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it('manages plans and creates a payment link for an organisation', async () => {
    const plan = await call('POST', '/api/operator/plans', {
      name: 'Business',
      stripePriceId: 'price_business1',
      maxUsers: 50,
      maxStorageMb: 2048,
    });
    expect(plan.statusCode, plan.body).toBe(200);
    planId = plan.json<{ id: string }>().id;
    expect(
      (
        await call('POST', '/api/operator/plans', {
          name: 'X',
          stripePriceId: 'price_business1',
          maxUsers: null,
          maxStorageMb: null,
        })
      ).statusCode,
    ).toBe(409);
    const created = await call('POST', '/api/operator/tenants', {
      name: 'Kunde E',
      publicOrigin: 'https://e.courses.test',
      contentOrigin: 'https://e.content.test',
      maxUsers: null,
      maxStorageMb: null,
    });
    tenantId = created.json<{ id: string }>().id;
    await call('PATCH', `/api/operator/tenants/${tenantId}`, {
      contactEmail: 'billing@kunde-e.example',
    });

    const link = await call('POST', `/api/operator/tenants/${tenantId}/payment-link`, { planId });
    expect(link.statusCode, link.body).toBe(200);
    expect(link.json<{ url: string }>().url).toMatch(/^https:\/\/checkout\.stripe\.test\/c\/cs_/);
    const customer = stripe.calls.find((c) => c.path === '/v1/customers');
    expect(customer?.params).toMatchObject({
      name: 'Kunde E',
      email: 'billing@kunde-e.example',
      'metadata[tenant_id]': tenantId,
    });
    const checkout = stripe.calls.find((c) => c.path === '/v1/checkout/sessions');
    expect(checkout?.params).toMatchObject({
      mode: 'subscription',
      'line_items[0][price]': 'price_business1',
      'metadata[tenant_id]': tenantId,
      'metadata[plan_id]': planId,
      success_url: 'https://e.courses.test/?billing=success',
    });
    expect((await tenant()).stripe_customer_id).toMatch(/^cus_/);
    // A second link reuses the Stripe customer.
    await call('POST', `/api/operator/tenants/${tenantId}/payment-link`, { planId });
    expect(stripe.calls.filter((c) => c.path === '/v1/customers')).toHaveLength(1);
    expect(
      (await call('POST', `/api/operator/tenants/${tenantId}/portal-link`)).json<{ url: string }>().url,
    ).toMatch(/^https:\/\/billing\.stripe\.test\//);
    expect((await call('GET', '/api/operator/installation')).json<{ billing: boolean }>().billing).toBe(true);
  });

  it('switches the organisation on with the plan when Stripe reports the payment, once', async () => {
    await t.ctx.db
      .updateTable('tenants')
      .set({ status: 'disabled' })
      .where('id', '=', tenantId)
      .execute()
      .catch(() => undefined);
    const completed = {
      object: 'checkout.session',
      mode: 'subscription',
      customer: (await tenant()).stripe_customer_id,
      subscription: 'sub_1',
      metadata: { tenant_id: tenantId, plan_id: planId },
    };
    const res = await webhook('checkout.session.completed', completed, { id: 'evt_paid' });
    expect(res.statusCode, res.body).toBe(200);
    expect(await tenant()).toMatchObject({
      status: 'active',
      billing_state: 'active',
      plan: 'Business',
      max_users: 50,
      max_storage_mb: 2048,
    });
    // Stripe delivers at least once: the same event changes nothing a second time.
    await t.ctx.db.updateTable('tenants').set({ max_users: 7 }).where('id', '=', tenantId).execute();
    expect((await webhook('checkout.session.completed', completed, { id: 'evt_paid' })).statusCode).toBe(200);
    expect((await tenant()).max_users).toBe(7);
  });

  it('keeps a late payer on, and switches a cancelled subscription off', async () => {
    const sub = (status: string) => ({
      object: 'subscription',
      id: 'sub_1',
      status,
      customer: 'cus_1',
      metadata: { tenant_id: tenantId },
      items: { data: [{ price: { id: 'price_business1' } }] },
    });
    await webhook('customer.subscription.updated', sub('past_due'));
    expect(await tenant()).toMatchObject({ status: 'active', billing_state: 'past_due', max_users: 50 });
    await webhook('customer.subscription.updated', sub('active'));
    expect((await tenant()).billing_state).toBe('active');
    await webhook('customer.subscription.deleted', sub('canceled'));
    expect(await tenant()).toMatchObject({ status: 'disabled', billing_state: 'canceled' });
  });

  it('refuses unsigned or wrongly signed events and never switches the default organisation off', async () => {
    expect(
      (await webhook('customer.subscription.deleted', {}, { secret: 'whsec_attacker_123' })).statusCode,
    ).toBe(400);
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/billing/stripe/webhook',
      headers: { 'content-type': 'application/json' },
      payload: '{}',
    });
    expect(res.statusCode).toBe(400);
    await webhook('customer.subscription.deleted', {
      id: 'sub_d',
      metadata: { tenant_id: DEFAULT_TENANT_ID },
    });
    const main = await t.ctx.db
      .selectFrom('tenants')
      .select('status')
      .where('id', '=', DEFAULT_TENANT_ID)
      .executeTakeFirstOrThrow();
    expect(main.status).toBe('active');
  });

  it('is not reachable without a webhook secret', async () => {
    const plain = await createTestApp();
    const res = await plain.app.inject({ method: 'POST', url: '/api/billing/stripe/webhook', payload: '{}' });
    expect(res.statusCode).toBe(404);
    await plain.close();
  });
});
