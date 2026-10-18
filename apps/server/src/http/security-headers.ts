// SPDX-License-Identifier: Apache-2.0
import helmet from '@fastify/helmet';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config/env.js';
import { contentUrl } from '../tenancy/origins.js';

const PERMISSIONS_POLICY = [
  'camera=(self)',
  'microphone=(self)',
  'display-capture=(self)',
  'geolocation=()',
  'payment=()',
  'usb=()',
  'serial=()',
].join(', ');

function directives(config: AppConfig, styleNonce?: string): Record<string, string[]> {
  const content = contentUrl(config);
  return {
    'default-src': ["'self'"],
    'script-src': ["'self'"],
    // A per-response nonce admits only the <style> element that the UI
    // library inserts; style attributes and other inline styles stay blocked.
    'style-src': styleNonce ? ["'self'", `'nonce-${styleNonce}'`] : ["'self'"],
    'img-src': ["'self'", 'data:', 'blob:'],
    'media-src': ["'self'", 'blob:'],
    'font-src': ["'self'"],
    'connect-src': ["'self'"],
    'object-src': ["'none'"],
    'base-uri': ["'none'"],
    'form-action': ["'self'"],
    // Course playback: the content origin, or the app itself when none is configured.
    'frame-src': content ? [content.origin] : ["'self'"],
    'frame-ancestors': ["'none'"],
  };
}

function frameSource(config: AppConfig): string {
  return contentUrl(config)?.origin ?? "'self'";
}

export function contentSecurityPolicy(config: AppConfig, styleNonce?: string): string {
  return Object.entries(directives(config, styleNonce))
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ');
}

/** Headers for the app origin. See SECURITY.md §5. */
export async function registerSecurityHeaders(app: FastifyInstance, config: AppConfig): Promise<void> {
  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      // Computed per response: the frame source is the content address of the request's tenant.
      directives: { ...directives(config), 'frame-src': [() => frameSource(config)] },
    },
    strictTransportSecurity:
      config.publicUrl.protocol === 'https:' ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    referrerPolicy: { policy: 'same-origin' },
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    crossOriginEmbedderPolicy: false,
    xFrameOptions: { action: 'deny' },
  });
  app.addHook('onSend', async (_request, reply) => {
    reply.header('Permissions-Policy', PERMISSIONS_POLICY);
  });
}
