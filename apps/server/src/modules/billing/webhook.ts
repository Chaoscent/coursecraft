// SPDX-License-Identifier: Apache-2.0
import type { Kysely } from 'kysely';
import type { Database } from '../../db/schema.js';
import { DEFAULT_TENANT_ID } from '../../tenancy/context.js';
import type { StripeEvent } from './stripe.js';

type Billing = 'active' | 'past_due' | 'canceled';

const str = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);
const meta = (object: Record<string, unknown>, key: string): string | null => {
  const m = object['metadata'];
  return m && typeof m === 'object' ? str((m as Record<string, unknown>)[key]) : null;
};

/** Subscription status → billing state; null: no change (e.g. still incomplete). */
function billingOf(status: string | null): Billing | null {
  switch (status) {
    case 'active':
    case 'trialing':
      return 'active';
    case 'past_due':
      return 'past_due';
    case 'unpaid':
    case 'canceled':
    case 'incomplete_expired':
      return 'canceled';
    default:
      return null;
  }
}

function priceOf(subscription: Record<string, unknown>): string | null {
  const items = subscription['items'];
  if (!items || typeof items !== 'object') return null;
  const data = (items as { data?: unknown }).data;
  if (!Array.isArray(data) || !data.length) return null;
  const price = (data[0] as { price?: unknown }).price;
  return price && typeof price === 'object' ? str((price as { id?: unknown }).id) : null;
}

/**
 * Applies one verified Stripe event to the organisation it belongs to. Every
 * event id is processed once (Stripe delivers at least once). A paid
 * subscription switches the organisation on with its plan's limits; past
 * due keeps it on (grace period, see the payment settings in Stripe); unpaid
 * or cancelled switches it off. The default organisation is never switched
 * off by billing.
 */
export async function handleStripeEvent(db: Kysely<Database>, event: StripeEvent): Promise<string> {
  // Events are only ever added (the app role may not change them). Applying an event twice
  // (two deliveries at the same moment) sets the same values twice, which is harmless.
  const seen = await db
    .selectFrom('billing_events')
    .select('id')
    .where('id', '=', event.id)
    .executeTakeFirst();
  if (seen) return 'duplicate';
  const object = event.data.object;
  let outcome = 'ignored';

  const findTenant = async () => {
    const byMeta = meta(object, 'tenant_id');
    const customer = str(object['customer']);
    const row = await db
      .selectFrom('tenants')
      .select(['id'])
      .where((eb) =>
        byMeta ? eb('id', '=', byMeta) : customer ? eb('stripe_customer_id', '=', customer) : eb.val(false),
      )
      .executeTakeFirst();
    return row?.id ?? null;
  };

  const apply = async (
    id: string,
    changes: {
      billing?: Billing | null;
      planId?: string | null;
      priceId?: string | null;
      subscription?: string | null;
    },
  ) => {
    const plan = changes.planId
      ? await db.selectFrom('billing_plans').selectAll().where('id', '=', changes.planId).executeTakeFirst()
      : changes.priceId
        ? await db
            .selectFrom('billing_plans')
            .selectAll()
            .where('stripe_price_id', '=', changes.priceId)
            .executeTakeFirst()
        : undefined;
    const customer = str(object['customer']);
    const billing = changes.billing ?? null;
    await db
      .updateTable('tenants')
      .set({
        ...(customer ? { stripe_customer_id: customer } : {}),
        ...(changes.subscription ? { stripe_subscription_id: changes.subscription } : {}),
        ...(billing ? { billing_state: billing } : {}),
        ...(billing === 'active' ? { status: 'active' as const } : {}),
        ...(billing === 'canceled' && id !== DEFAULT_TENANT_ID ? { status: 'disabled' as const } : {}),
        ...(plan
          ? {
              plan_id: plan.id,
              plan: plan.name,
              max_users: plan.max_users,
              max_storage_mb: plan.max_storage_mb,
            }
          : {}),
      })
      .where('id', '=', id)
      .execute();
  };

  const tenantId = await findTenant();
  if (tenantId) {
    switch (event.type) {
      case 'checkout.session.completed':
        if (object['mode'] === 'subscription') {
          await apply(tenantId, {
            billing: 'active',
            planId: meta(object, 'plan_id'),
            subscription: str(object['subscription']),
          });
          outcome = 'activated';
        }
        break;
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const billing = billingOf(str(object['status']));
        await apply(tenantId, { billing, priceId: priceOf(object), subscription: str(object['id']) });
        outcome = billing ?? 'unchanged';
        break;
      }
      case 'customer.subscription.deleted':
        await apply(tenantId, { billing: 'canceled', subscription: str(object['id']) });
        outcome = 'canceled';
        break;
      case 'invoice.payment_failed':
        await apply(tenantId, { billing: 'past_due' });
        outcome = 'past_due';
        break;
    }
  } else outcome = 'no organisation';
  await db
    .insertInto('billing_events')
    .values({ id: event.id, type: event.type, tenant_id: tenantId, outcome })
    .onConflict((oc) => oc.column('id').doNothing())
    .execute();
  return outcome;
}
