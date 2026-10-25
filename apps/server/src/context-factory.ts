// SPDX-License-Identifier: Apache-2.0
import { SessionService } from './auth/sessions.js';
import type { AppConfig } from './config/env.js';
import { SecretBox } from './crypto/secret-box.js';
import { createDatabase } from './db/connection.js';
import type { AppContext } from './http/context.js';
import { RecordingQueue, type JobQueue } from './jobs/queue.js';
import { AssetStore } from './modules/assets/store.js';
import { AuditService } from './modules/audit/service.js';
import { TenantDirectory } from './tenancy/directory.js';
import { createBlobStore, createWorkExchange } from './storage.js';

export function createContext(config: AppConfig, jobs: JobQueue = new RecordingQueue()): AppContext {
  const db = createDatabase(config.databaseUrl, { tenancy: config.tenancy });
  const blobs = createBlobStore(config);
  return {
    config,
    db,
    box:
      config.masterKeys && config.masterKeyCurrent
        ? new SecretBox(config.masterKeys, config.masterKeyCurrent)
        : SecretBox.single(config.masterKey),
    sessions: new SessionService(
      db,
      { idleMinutes: config.sessionIdleMinutes, absoluteHours: config.sessionAbsoluteHours },
      config.ipPepper,
    ),
    audit: new AuditService(db),
    assets: new AssetStore(blobs),
    blobs,
    tenants: new TenantDirectory(db),
    jobs,
    work: createWorkExchange(config, blobs),
    log: { info: () => undefined, warn: () => undefined, error: () => undefined },
  };
}
