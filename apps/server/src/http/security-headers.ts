// SPDX-License-Identifier: Apache-2.0
import helmet from '@fastify/helmet';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config/env.js';

const PERMISSIONS_POLICY = [
  'camera=(self)',
  'microphone=(self)',
  'display-capture=(self)',
  'geolocation=()',
  'payment=()',
  'usb=()',
  'serial=()',
  'bluetooth=()',
].join(', ');

/** Headers for the app origin. See SECURITY.md §5. */
export async function registerSecurityHeaders(app: FastifyInstance, config: AppConfig): Promise<void> {
  const frameSrc = config.contentUrl ? [config.contentUrl.origin] : ["'none'"];
  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        mediaSrc: ["'self'", 'blob:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'self'"],
        frameSrc,
        frameAncestors: ["'none'"],
      },
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
