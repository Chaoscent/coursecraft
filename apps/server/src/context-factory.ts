// SPDX-License-Identifier: Apache-2.0
import { SessionService } from './auth/sessions.js';
import type { AppConfig } from './config/env.js';
import { SecretBox } from './crypto/secret-box.js';
import { createDatabase } from './db/connection.js';
import type { AppContext } from './http/context.js';
import { AuditService } from './modules/audit/service.js';

export function createContext(config: AppConfig): AppContext {
  const db = createDatabase(config.databaseUrl);
  return {
    config,
    db,
    box: SecretBox.single(config.masterKey),
    sessions: new SessionService(
      db,
      { idleMinutes: config.sessionIdleMinutes, absoluteHours: config.sessionAbsoluteHours },
      config.ipPepper,
    ),
    audit: new AuditService(db),
  };
}
