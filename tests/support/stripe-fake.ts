// SPDX-License-Identifier: Apache-2.0
/** A stand-in for the few Stripe API endpoints Coursecraft calls, on loopback. */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface StripeCall {
  path: string;
  params: Record<string, string>;
  auth: string;
}

export class FakeStripe {
  readonly key = 'sk_test_fake_0123456789';
  readonly calls: StripeCall[] = [];
  base = '';
  #server: Server | null = null;
  #n = 0;

  async start(): Promise<void> {
    this.#server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const params = Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString('utf8')));
        const path = req.url ?? '';
        this.calls.push({ path, params, auth: req.headers.authorization ?? '' });
        const send = (status: number, body: unknown) => {
          res.writeHead(status, { 'content-type': 'application/json' });
          res.end(JSON.stringify(body));
        };
        if (req.headers.authorization !== `Bearer ${this.key}`)
          return send(401, { error: { message: 'Invalid API Key provided' } });
        this.#n += 1;
        if (path === '/v1/customers') return send(200, { id: `cus_${this.#n}` });
        if (path === '/v1/checkout/sessions')
          return send(200, { id: `cs_${this.#n}`, url: `https://checkout.stripe.test/c/cs_${this.#n}` });
        if (path === '/v1/billing_portal/sessions')
          return send(200, { id: `bps_${this.#n}`, url: `https://billing.stripe.test/p/bps_${this.#n}` });
        send(404, { error: { message: 'Unrecognized request URL' } });
      });
    });
    await new Promise<void>((resolve) => this.#server?.listen(0, '127.0.0.1', resolve));
    this.base = `http://127.0.0.1:${(this.#server.address() as AddressInfo).port}`;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.#server?.close(() => resolve()));
  }
}
