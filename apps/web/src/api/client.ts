// SPDX-License-Identifier: Apache-2.0
/**
 * The only place in the web app that talks to the network. Adds the CSRF
 * token, sends JSON, and validates every response with the shared schema.
 */
import type { ErrorCode } from '@coursecraft/shared';
import type { z } from 'zod';

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode | 'network';

  constructor(status: number, code: ErrorCode | 'network', message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

let csrfToken: string | null = null;
const unauthenticatedListeners = new Set<() => void>();

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

/** Called when the server reports that the session is gone. */
export function onUnauthenticated(listener: () => void): () => void {
  unauthenticatedListeners.add(listener);
  return () => unauthenticatedListeners.delete(listener);
}

type Query = Record<string, string | number | boolean | undefined>;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Raw text body (e.g. CSV) with its content type. */
  text?: { content: string; type: string };
  /** Multipart upload (files). */
  form?: FormData;
  query?: Query;
  /** Lets the request outlive the page (unlock on close). */
  keepalive?: boolean;
}

function withQuery(path: string, query?: Query): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query))
    if (value !== undefined && value !== '') params.set(key, String(value));
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

export async function api<S extends z.ZodType>(
  schema: S,
  path: string,
  options: RequestOptions = {},
): Promise<z.output<S>> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };
  let body: string | FormData | undefined;
  if (options.form) {
    body = options.form;
  } else if (options.text) {
    headers['Content-Type'] = options.text.type;
    body = options.text.content;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;

  let response: Response;
  try {
    response = await fetch(withQuery(path, options.query), {
      method,
      headers,
      body: body ?? null,
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError(0, 'network', 'Server not reachable');
  }
  const data: unknown = response.headers.get('content-type')?.includes('json') ? await response.json() : null;
  if (!response.ok) {
    const error = (data as { error?: { code?: ErrorCode; message?: string } } | null)?.error;
    if (response.status === 401) for (const listener of unauthenticatedListeners) listener();
    throw new ApiError(response.status, error?.code ?? 'internal', error?.message ?? response.statusText);
  }
  return schema.parse(data);
}

/** Reads a same-origin file as bytes (e.g. audio for the waveform). */
export async function fetchBytes(path: string): Promise<ArrayBuffer> {
  const response = await fetch(path, { credentials: 'same-origin' });
  if (!response.ok) throw new ApiError(response.status, 'internal', response.statusText);
  return response.arrayBuffer();
}

/** Downloads a JSON response as a file (GDPR export). */
export async function download(path: string, filename: string): Promise<void> {
  const response = await fetch(path, { credentials: 'same-origin' });
  if (!response.ok) throw new ApiError(response.status, 'internal', response.statusText);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
