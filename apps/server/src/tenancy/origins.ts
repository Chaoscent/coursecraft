// SPDX-License-Identifier: Apache-2.0
import type { AppConfig } from '../config/env.js';
import { currentScope, DEFAULT_TENANT_ID } from './context.js';

/** The application address of the current tenant (or of the installation). */
export function publicUrl(config: AppConfig): URL {
  const origin = currentScope()?.publicOrigin;
  return origin ? new URL(origin) : config.publicUrl;
}

/** The course playback address of the current tenant, if there is one. */
export function contentUrl(config: AppConfig): URL | undefined {
  const scope = currentScope();
  if (scope?.contentOrigin) return new URL(scope.contentOrigin);
  return scope?.publicOrigin ? undefined : config.contentUrl;
}

/** Key prefix for stored files: none for the default tenant, so single installations keep their layout. */
export function storagePrefix(): string {
  const id = currentScope()?.id ?? DEFAULT_TENANT_ID;
  return id === DEFAULT_TENANT_ID ? '' : `tenants/${id}/`;
}
