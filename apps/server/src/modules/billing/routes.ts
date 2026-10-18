// SPDX-License-Identifier: Apache-2.0
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../http/context.js';
import { AppError } from '../../http/errors.js';
import { verifyStripeEvent } from './stripe.js';
import { handleStripeEvent } from './webhook.js';

export const STRIPE_WEBHOOK_PATH = '/api/billing/stripe/webhook';

/**
 * Stripe's webhook (optional; only with COURSECRAFT_STRIPE_WEBHOOK_SECRET).
 * Stripe posts from its own servers: no session, no origin, so the route
 * skips the origin check and trusts nothing but a valid signature over the
 * raw body. It works without an organisation scope: it changes the
 * organisations themselves.
 */
export function billingRoutes(app: FastifyInstance, ctx: AppContext): void {
  const secret = ctx.config.stripeWebhookSecret;
  if (!secret) return;
  app.register((scope, _options, done) => {
    // The signature covers the exact bytes, so this scope keeps JSON bodies unparsed.
    scope.removeContentTypeParser('application/json');
    scope.addContentTypeParser(
      'application/json',
      { parseAs: 'buffer', bodyLimit: 1_048_576 },
      (_req, body, parsed) => parsed(null, body),
    );
    scope.post(
      STRIPE_WEBHOOK_PATH,
      { config: { permission: 'public', crossSite: true, rateLimit: { max: 600, timeWindow: '1 minute' } } },
      async (request) => {
        const raw = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
        const signature = request.headers['stripe-signature'];
        const event = verifyStripeEvent(raw, typeof signature === 'string' ? signature : undefined, secret);
        if (!event) throw new AppError('bad_request', 'Invalid signature');
        const outcome = await handleStripeEvent(ctx.db, event);
        if (outcome !== 'duplicate' && outcome !== 'ignored') ctx.tenants.invalidate();
        request.log.info({ type: event.type, outcome }, 'stripe event');
        return { received: true };
      },
    );
    done();
  });
}
