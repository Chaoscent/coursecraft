// SPDX-License-Identifier: Apache-2.0
/**
 * The few Stripe calls Coursecraft needs, over HTTPS with form encoding (no
 * SDK), and the verification of webhook signatures. Card and bank details
 * never pass through Coursecraft: payment happens on Stripe's pages.
 */
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export const STRIPE_API = 'https://api.stripe.com';
const TIMEOUT_MS = 20_000;

type Params = Record<string, string | undefined>;

export class StripeError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'StripeError';
    this.status = status;
  }
}

const idSchema = z.object({ id: z.string(), url: z.string().optional() });

export class StripeClient {
  readonly #key: string;
  readonly #base: string;

  constructor(secretKey: string, apiBase: string = STRIPE_API) {
    this.#key = secretKey;
    this.#base = apiBase.replace(/\/+$/, '');
  }

  async #post(path: string, params: Params): Promise<z.infer<typeof idSchema>> {
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value !== undefined) body.set(key, value);
    const res = await fetch(`${this.#base}${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.#key}`,
        'content-type': 'application/x-www-form-urlencoded',
        // A retried request never creates a second customer or session.
        'idempotency-key': randomUUID(),
      },
      body: body.toString(),
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const json: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const message = z.object({ error: z.object({ message: z.string() }) }).safeParse(json);
      throw new StripeError(
        res.status,
        message.success ? message.data.error.message : `Stripe answered ${res.status}`,
      );
    }
    return idSchema.parse(json);
  }

  async createCustomer(input: { name: string; email: string | null; tenantId: string }): Promise<string> {
    const customer = await this.#post('/v1/customers', {
      name: input.name,
      email: input.email ?? undefined,
      'metadata[tenant_id]': input.tenantId,
    });
    return customer.id;
  }

  /** A hosted payment page for a subscription to one price. */
  async createCheckout(input: {
    customer: string;
    priceId: string;
    tenantId: string;
    planId: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<string> {
    const session = await this.#post('/v1/checkout/sessions', {
      mode: 'subscription',
      customer: input.customer,
      'line_items[0][price]': input.priceId,
      'line_items[0][quantity]': '1',
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      'metadata[tenant_id]': input.tenantId,
      'metadata[plan_id]': input.planId,
      'subscription_data[metadata][tenant_id]': input.tenantId,
      'subscription_data[metadata][plan_id]': input.planId,
    });
    if (!session.url) throw new StripeError(502, 'Stripe returned no payment page');
    return session.url;
  }

  /** Stripe's customer portal: payment method, invoices, cancellation. */
  async createPortal(input: { customer: string; returnUrl: string }): Promise<string> {
    const session = await this.#post('/v1/billing_portal/sessions', {
      customer: input.customer,
      return_url: input.returnUrl,
    });
    if (!session.url) throw new StripeError(502, 'Stripe returned no portal page');
    return session.url;
  }
}

export const stripeEventSchema = z.object({
  id: z.string().min(1).max(255),
  type: z.string().min(1).max(255),
  data: z.object({ object: z.record(z.string(), z.unknown()) }),
});
export type StripeEvent = z.infer<typeof stripeEventSchema>;

/**
 * Checks the `Stripe-Signature` header (HMAC-SHA256 over "timestamp.body" with
 * the endpoint secret) and the timestamp (replays older than five minutes are
 * refused). Returns the event, or null when anything is off.
 */
export function verifyStripeEvent(
  rawBody: Buffer,
  header: string | undefined,
  secret: string,
  now = Date.now(),
  toleranceSeconds = 300,
): StripeEvent | null {
  if (!header) return null;
  const parts = header.split(',').map((p) => p.trim().split('='));
  const timestamp = Number(parts.find(([k]) => k === 't')?.[1]);
  const signatures = parts.filter(([k]) => k === 'v1').map(([, v]) => v ?? '');
  if (!Number.isFinite(timestamp) || !signatures.length) return null;
  if (Math.abs(now / 1000 - timestamp) > toleranceSeconds) return null;
  const expected = createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest();
  const valid = signatures.some((sig) => {
    const given = Buffer.from(sig, 'hex');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  if (!valid) return null;
  try {
    const parsed = stripeEventSchema.safeParse(JSON.parse(rawBody.toString('utf8')));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Header value as Stripe sends it (for tests and the fake server). */
export function signStripePayload(
  body: string,
  secret: string,
  timestamp = Math.floor(Date.now() / 1000),
): string {
  const v1 = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${v1}`;
}
