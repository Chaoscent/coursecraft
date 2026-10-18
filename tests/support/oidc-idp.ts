// SPDX-License-Identifier: Apache-2.0
/** A minimal OpenID Connect provider on loopback for tests: discovery, keys, token endpoint with PKCE. */
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';

export interface IdpUser {
  sub: string;
  groups?: string[];
  email?: string;
  email_verified?: boolean;
  name?: string;
}

interface Grant {
  user: IdpUser;
  nonce: string;
  challenge: string;
  redirectUri: string;
  clientId: string;
  used: boolean;
}

export class FakeIdp {
  readonly clientId = 'coursecraft-test';
  readonly clientSecret = 'idp-client-secret-9876';
  issuer = '';
  /** Overrides applied to the next ID token (e.g. a wrong nonce). */
  tamper: { nonce?: string; aud?: string } = {};
  requireSecret = true;
  #server: Server | null = null;
  #grants = new Map<string, Grant>();
  #jwk: JWK | null = null;
  #privateKey: CryptoKey | null = null;

  async start(): Promise<void> {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    this.#privateKey = privateKey;
    this.#jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
    this.#server = createServer((req, res) => void this.#handle(req, res));
    await new Promise<void>((resolve) => this.#server?.listen(0, '127.0.0.1', resolve));
    this.issuer = `http://127.0.0.1:${(this.#server.address() as AddressInfo).port}`;
  }

  async stop(): Promise<void> {
    await new Promise((resolve) => this.#server?.close(resolve));
  }

  /** What the browser does at the provider: returns the URL the provider sends it back to. */
  authorize(authorizationUrl: string, user: IdpUser): string {
    const url = new URL(authorizationUrl);
    const p = url.searchParams;
    expectParam(p.get('response_type'), 'code');
    expectParam(p.get('code_challenge_method'), 'S256');
    const code = randomBytes(16).toString('hex');
    this.#grants.set(code, {
      user,
      nonce: p.get('nonce') ?? '',
      challenge: p.get('code_challenge') ?? '',
      redirectUri: p.get('redirect_uri') ?? '',
      clientId: p.get('client_id') ?? '',
      used: false,
    });
    const back = new URL(p.get('redirect_uri') ?? '');
    back.searchParams.set('code', code);
    back.searchParams.set('state', p.get('state') ?? '');
    back.searchParams.set('iss', this.issuer);
    return back.toString();
  }

  async #handle(req: IncomingMessage, res: ServerResponse) {
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    const path = new URL(req.url ?? '/', this.issuer).pathname;
    if (path === '/.well-known/openid-configuration') {
      return json(200, {
        issuer: this.issuer,
        authorization_endpoint: `${this.issuer}/authorize`,
        token_endpoint: `${this.issuer}/token`,
        jwks_uri: `${this.issuer}/jwks`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
        code_challenge_methods_supported: ['S256'],
        authorization_response_iss_parameter_supported: true,
        end_session_endpoint: `${this.issuer}/logout`,
      });
    }
    if (path === '/jwks') return json(200, { keys: [this.#jwk] });
    if (path === '/token' && req.method === 'POST') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const form = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
      const grant = this.#grants.get(form.get('code') ?? '');
      if (!grant || grant.used) return json(400, { error: 'invalid_grant' });
      grant.used = true;
      const verifier = form.get('code_verifier') ?? '';
      const challenge = createHash('sha256').update(verifier).digest('base64url');
      if (challenge !== grant.challenge || form.get('redirect_uri') !== grant.redirectUri) {
        return json(400, { error: 'invalid_grant' });
      }
      if (this.requireSecret && form.get('client_secret') !== this.clientSecret) {
        return json(401, { error: 'invalid_client' });
      }
      const idToken = await new SignJWT({
        ...grant.user,
        nonce: this.tamper.nonce ?? grant.nonce,
      })
        .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
        .setIssuer(this.issuer)
        .setAudience(this.tamper.aud ?? grant.clientId)
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(this.#privateKey as CryptoKey);
      return json(200, { access_token: 'at', token_type: 'Bearer', expires_in: 300, id_token: idToken });
    }
    json(404, { error: 'not_found' });
  }
}

function expectParam(actual: string | null, expected: string): void {
  if (actual !== expected) throw new Error(`Authorization request: expected ${expected}, got ${actual}`);
}
