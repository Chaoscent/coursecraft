// SPDX-License-Identifier: Apache-2.0
import type { Permission, Role } from '@lernwerk/shared';
import type { Kysely } from 'kysely';
import type { SessionService } from '../auth/sessions.js';
import type { AppConfig } from '../config/env.js';
import type { SecretBox } from '../crypto/secret-box.js';
import type { Database } from '../db/schema.js';
import type { JobQueue } from '../jobs/queue.js';
import type { WorkDir } from '../jobs/work-dir.js';
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
  jobs: JobQueue;
  work: WorkDir;
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
  }
}
