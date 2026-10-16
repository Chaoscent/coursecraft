// SPDX-License-Identifier: Apache-2.0
import type { ColumnType, Generated, JSONColumnType } from 'kysely';

/** Timestamps: read as Date, written as Date or ISO string, defaulted by the DB. */
type Timestamp = ColumnType<Date, Date | string, Date | string>;
type CreatedAt = ColumnType<Date, Date | string | undefined, never>;

export interface SettingsTable {
  key: string;
  value: JSONColumnType<Record<string, unknown>>;
  updated_at: ColumnType<Date, never, Date>;
}

/** Maintained by Kysely's migrator; read for readiness checks. */
export interface KyselyMigrationTable {
  name: string;
  timestamp: Generated<string>;
}

export interface SealedJson {
  ciphertext: string;
  nonce: string;
  keyVersion: number;
}

export interface UsersTable {
  id: Generated<string>;
  email: string;
  display_name: string;
  password_hash: string | null;
  status: ColumnType<'active' | 'disabled', 'active' | 'disabled' | undefined>;
  locale: ColumnType<'de' | 'en', 'de' | 'en' | undefined>;
  totp_secret: JSONColumnType<SealedJson | null, string | null, string | null>;
  totp_last_step: ColumnType<string | null, number | null, number | null>;
  must_change_password: Generated<boolean>;
  failed_logins: Generated<number>;
  locked_until: Timestamp | null;
  last_login_at: Timestamp | null;
  created_at: CreatedAt;
  updated_at: ColumnType<Date, Date | string | undefined, Date | string>;
  deleted_at: Timestamp | null;
}

export interface UserRolesTable {
  user_id: string;
  role: 'admin' | 'author' | 'trainer' | 'learner';
}

export interface GroupsTable {
  id: Generated<string>;
  name: string;
  parent_id: string | null;
  created_at: CreatedAt;
}

export interface GroupMembersTable {
  group_id: string;
  user_id: string;
}

export interface SessionsTable {
  id: Generated<string>;
  token_hash: string;
  user_id: string;
  created_at: CreatedAt;
  last_seen_at: ColumnType<Date, Date | string | undefined, Date | string>;
  idle_expires_at: Timestamp;
  absolute_expires_at: Timestamp;
  rotate_pending: Generated<boolean>;
  ip_hmac: string | null;
  user_agent: string | null;
}

export interface LoginChallengesTable {
  id: Generated<string>;
  token_hash: string;
  user_id: string;
  expires_at: Timestamp;
  attempts: Generated<number>;
}

export interface SetupStateTable {
  id: number;
  completed_at: Timestamp | null;
  token_hash: string | null;
  token_expires_at: Timestamp | null;
}

export interface AuditLogTable {
  id: ColumnType<string, never, never>;
  at: CreatedAt;
  actor_user_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  meta: JSONColumnType<Record<string, unknown>>;
  ip_hmac: string | null;
}

export interface Database {
  settings: SettingsTable;
  kysely_migration: KyselyMigrationTable;
  users: UsersTable;
  user_roles: UserRolesTable;
  groups: GroupsTable;
  group_members: GroupMembersTable;
  sessions: SessionsTable;
  login_challenges: LoginChallengesTable;
  setup_state: SetupStateTable;
  audit_log: AuditLogTable;
}
