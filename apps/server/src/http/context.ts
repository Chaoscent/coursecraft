// SPDX-License-Identifier: Apache-2.0
import type { Permission, Role } from '@coursecraft/shared';
import type { Kysely } from 'kysely';
import type { SessionService } from '../auth/sessions.js';
import type { AppConfig } from '../config/env.js';
import type { SecretBox } from '../crypto/secret-box.js';
import type { Database } from '../db/schema.js';
import type { JobQueue } from '../jobs/queue.js';
import type { WorkExchange } from '../jobs/work-dir.js';
import type { BlobStore } from '@coursecraft/storage';
import type { TenantDirectory } from '../tenancy/directory.js';
import type { AssetStore } from '../modules/assets/store.js';
import type { AuditService } from '../modules/audit/service.js';

/** Shared services handed to every route module. */
export interface AppContext {
  config: AppConfig;
  db: Kysely<Database>;
  box: SecretBox;
  sessions: SessionService;
  audit: AuditService;
  assets: AssetStore;
  /** All stored files (assets, extracted packages, converter exchange) behind one interface. */
  blobs: BlobStore;
  /** Tenants by address (several organisations in one installation). */
  tenants: TenantDirectory;
  jobs: JobQueue;
  work: WorkExchange;
  /** Replaced by the HTTP server's logger once it exists. */
  log: Logger;
}

export interface Logger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

export interface AuthState {
  sessionId: string;
  userId: string;
  email: string;
  displayName: string;
  locale: 'de' | 'en';
  roles: Role[];
  permissions: Permission[];
  mustChangePassword: boolean;
  totpEnabled: boolean;
  csrfToken: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthState | null;
    /** HMAC of the client IP with the server pepper (never the raw address). */
    ipHmac: string;
  }
  interface FastifyContextConfig {
    /** Route stays usable while the user must change the password. */
    allowDuringPasswordChange?: boolean;
    /** Route accepts multipart/form-data (file uploads). */
    allowMultipart?: boolean;
    /**
     * Receives a form post from another site (SAML assertion consumer). The
     * origin check is replaced by the login state bound to the browser.
     */
    crossSite?: boolean;
    /** Authenticated by a launch token in the path; cookies are ignored. */
    tokenAuth?: boolean;
  }
}
