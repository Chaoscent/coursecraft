# Billing with Stripe (optional)

Coursecraft can bill the organisations of a multi-organisation installation
(`COURSECRAFT_TENANCY=multi`, see [multi-tenancy.md](multi-tenancy.md))
through Stripe subscriptions. It is off by default. Without the two settings
below there is no billing code path, no webhook route and no request to
Stripe. Operators who bill by invoice or not at all keep doing what they do
today: they set the plan label and limits by hand in the operator console.

What it does:

- **Plans** in the operator console tie a Stripe price to limits (users,
  storage).
- **Payment link**: the operator picks a plan for an organisation, and the
  console creates a Stripe Checkout page for a subscription. The operator
  sends the link to the customer.
- When Stripe reports the payment, the organisation gets the plan's name and
  limits and is switched on. When a payment fails, it stays on (overdue).
  When the subscription ends, it is switched off. Its data is kept, and
  switching it on again is one click. The default organisation is never
  switched off by billing.
- **Customer portal link**: the customer changes the payment method, sees
  invoices or cancels in Stripe's own portal.

Coursecraft stores the Stripe customer and subscription ids and the payment
state only. Card data, invoices and taxes stay in Stripe.

## Setting it up

1. **Stripe dashboard → Products**: create a product per plan with a
   recurring price, and note the price id (`price_…`).
2. **Developers → API keys**: create a restricted key with write access to
   _Customers_, _Checkout Sessions_ and _Customer portal_ (or use the secret
   key). This key is for the operator console only.
3. **Developers → Webhooks → Add endpoint**:
   - URL: `<COURSECRAFT_PUBLIC_URL>/api/billing/stripe/webhook`, for example
     `https://courses.example.com/api/billing/stripe/webhook`. The reverse
     proxy must pass it to the app like every other path.
   - Events: `checkout.session.completed`,
     `customer.subscription.created`, `customer.subscription.updated`,
     `customer.subscription.deleted`, `invoice.payment_failed`.
   - Note the signing secret (`whsec_…`).
4. **Settings → Billing → Customer portal**: switch the portal on and choose
   what customers may do there (payment method, invoices, cancel).
5. **Settings → Billing → Subscriptions and emails**: choose what happens
   after failed payments (retries, then _cancel_ or _mark unpaid_). That is
   the grace period. Until then the organisation stays on as _overdue_.
6. Configure Coursecraft:

   | Setting                             | Where               | Value         |
   | ----------------------------------- | ------------------- | ------------- |
   | `COURSECRAFT_STRIPE_SECRET_KEY`     | operator console    | `sk_…`/`rk_…` |
   | `COURSECRAFT_STRIPE_WEBHOOK_SECRET` | app (every replica) | `whsec_…`     |
   - Docker Compose: both in `.env`, then
     `docker compose --profile operator up -d`.
   - Helm: create a Secret with the keys `secretKey` and `webhookSecret` and
     set `billing.stripeSecret=<name of the Secret>`.
   - Both settings also accept `…_FILE` (path to a file with the value).

7. In the operator console, under **Plans**, add each plan with its price id
   and limits. Then select an organisation, use **Payment link …**, and send
   the link.

## Test mode

Use Stripe's test mode keys (`sk_test_…`) and test cards. To receive
webhooks on a machine that Stripe cannot reach, use the Stripe CLI:

```sh
stripe listen --forward-to localhost:3000/api/billing/stripe/webhook
```

It prints a `whsec_…` secret for `COURSECRAFT_STRIPE_WEBHOOK_SECRET`.

## How it is secured

- The webhook accepts only events whose `Stripe-Signature` (HMAC-SHA256 over
  the exact request body with the endpoint's signing secret) is valid and at
  most five minutes old. Anything else gets 400. The route is rate-limited.
- Stripe delivers at least once. Each event id is applied once and recorded
  in `billing_events` (the app role may only add rows there).
- The app role may change only the billing and limit columns of
  `tenants` and may only read `billing_plans`. Plans are managed by the
  operator console (table owner).
- Only the operator console holds the API key. The app never calls Stripe;
  it only receives events.
- Organisations are found by the `tenant_id` in the Checkout metadata, or
  by their Stripe customer id. Events for unknown customers are recorded and
  otherwise ignored.

## Not covered

- Self-service sign-up with payment (a new customer creating their own
  organisation). The operator creates organisations and sends the link.
- Usage-based prices, several prices per subscription, coupons in the
  console (Stripe's Checkout and portal can offer promotion codes).
