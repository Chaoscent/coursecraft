// SPDX-License-Identifier: Apache-2.0
import type { Kysely } from 'kysely';
import { ident, now, oneOf, randomUuid } from './sql-helpers.js';

/**
 * Optional Stripe billing: plans (a Stripe price with limits), the billing
 * state of each organisation, and every webhook event processed once.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('billing_plans')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(randomUuid()))
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('stripe_price_id', 'text', (c) => c.notNull().unique())
    .addColumn('max_users', 'integer')
    .addColumn('max_storage_mb', 'integer')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(now()))
    .execute();
  await db.schema
    .alterTable('tenants')
    .addColumn('plan_id', 'uuid', (c) => c.references('billing_plans.id').onDelete('set null'))
    .addColumn('stripe_customer_id', 'text', (c) => c.unique())
    .addColumn('stripe_subscription_id', 'text')
    .addColumn('billing_state', 'text')
    .execute();
  await db.schema
    .alterTable('tenants')
    .addCheckConstraint(
      'tenants_billing_state_check',
      oneOf(ident('billing_state'), ['active', 'past_due', 'canceled']),
    )
    .execute();
  await db.schema
    .createTable('billing_events')
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('type', 'text', (c) => c.notNull())
    .addColumn('tenant_id', 'uuid')
    .addColumn('outcome', 'text', (c) => c.notNull())
    .addColumn('received_at', 'timestamptz', (c) => c.notNull().defaultTo(now()))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('billing_events').execute();
  await db.schema.alterTable('tenants').dropConstraint('tenants_billing_state_check').execute();
  await db.schema
    .alterTable('tenants')
    .dropColumn('billing_state')
    .dropColumn('stripe_subscription_id')
    .dropColumn('stripe_customer_id')
    .dropColumn('plan_id')
    .execute();
  await db.schema.dropTable('billing_plans').execute();
}
