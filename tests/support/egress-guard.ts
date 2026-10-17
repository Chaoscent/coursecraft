// SPDX-License-Identifier: Apache-2.0
/**
 * Egress guard for server tests: any connection to a host other than the
 * loopback interface fails the test (Postgres from testcontainers and fake
 * AI providers listen on loopback). Unix sockets (Docker) are allowed.
 */
import net from 'node:net';
import { isIP } from 'node:net';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export const blocked: string[] = [];

function allowed(host: string | undefined): boolean {
  if (!host) return true;
  return LOOPBACK.has(host) || (isIP(host) === 4 && host.startsWith('127.'));
}

const originalConnect = Reflect.get(net.Socket.prototype, 'connect') as (...args: unknown[]) => net.Socket;
net.Socket.prototype.connect = function guardedConnect(this: net.Socket, ...args: unknown[]) {
  // Node's own callers pass the already normalised arguments as one array.
  const [first, second] = Array.isArray(args[0]) ? (args[0] as unknown[]) : args;
  const options =
    typeof first === 'object' && first !== null && !Array.isArray(first)
      ? (first as { host?: string; path?: string })
      : typeof first === 'number' || (typeof first === 'string' && /^\d+$/.test(first))
        ? { host: typeof second === 'string' ? second : 'localhost' }
        : { path: typeof first === 'string' ? first : '' };
  if (!options.path && !allowed(options.host)) {
    blocked.push(options.host ?? '');
    throw new Error(`Egress guard: connection to ${options.host ?? '?'} is not allowed in tests`);
  }
  return Reflect.apply(originalConnect, this, args);
};

const originalFetch = globalThis.fetch;
globalThis.fetch = (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!allowed(host)) {
    blocked.push(host);
    return Promise.reject(new Error(`Egress guard: request to ${url.host} is not allowed in tests`));
  }
  return originalFetch(input, init);
};
