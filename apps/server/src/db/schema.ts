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
  /** Second-factor brute-force counter and lock (F-09), separate from the password counter. */
  totp_failed: Generated<number>;
  totp_locked_until: Timestamp | null;
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
  sso_provider_id: ColumnType<string | null, string | null | undefined, string | null>;
  sso_logout: JSONColumnType<SealedJson | null, string | null | undefined, string | null>;
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

export interface CoursesTable {
  id: Generated<string>;
  title: string;
  owner_id: string;
  status: ColumnType<'draft' | 'archived', 'draft' | 'archived' | undefined>;
  format_version: number;
  meta: JSONColumnType<Record<string, unknown>>;
  languages: JSONColumnType<{ default: string; available: string[] }>;
  settings: JSONColumnType<Record<string, unknown>>;
  structure: JSONColumnType<{ chapters: { id: string; title: Record<string, string>; nodeIds: string[] }[] }>;
  rev: Generated<number>;
  created_at: CreatedAt;
  updated_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

export interface CourseMembersTable {
  course_id: string;
  user_id: string;
  role: ColumnType<'editor', 'editor' | undefined>;
}

export interface CourseNodesTable {
  course_id: string;
  node_id: string;
  kind: string;
  doc: JSONColumnType<Record<string, unknown>>;
  rev: Generated<number>;
  updated_at: ColumnType<Date, Date | string | undefined, Date | string>;
  updated_by: string | null;
}

export interface AssetsTable {
  sha256: string;
  mime: string;
  size: ColumnType<string, number, number>;
  created_at: CreatedAt;
  created_by: string | null;
}

export interface CourseAssetsTable {
  course_id: string;
  sha256: string;
  name: string;
  created_at: CreatedAt;
}

export interface CourseLocksTable {
  course_id: string;
  user_id: string;
  session_id: string;
  acquired_at: ColumnType<Date, Date | string | undefined, Date | string>;
  heartbeat_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

export interface CourseVersionsTable {
  id: Generated<string>;
  course_id: string;
  number: number;
  note: ColumnType<string, string | undefined, string>;
  snapshot: JSONColumnType<Record<string, unknown>>;
  created_by: string | null;
  created_at: CreatedAt;
}

export interface ConversionsTable {
  id: Generated<string>;
  kind: 'pptx-import' | 'media';
  status: ColumnType<'pending' | 'done' | 'failed', 'pending' | undefined, 'done' | 'failed'>;
  created_by: string;
  course_id: string | null;
  input_name: string;
  payload: JSONColumnType<Record<string, unknown>, string | undefined, string>;
  result: JSONColumnType<Record<string, unknown>, string | undefined, string>;
  error: string | null;
  created_at: ColumnType<Date, Date | undefined, Date>;
  finished_at: Date | null;
}

type DefaultedTimestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type Json<T extends object = Record<string, unknown>> = JSONColumnType<T, string | undefined, string>;

export type PackageKind = 'coursecraft' | 'scorm12' | 'scorm2004' | 'xapi' | 'cmi5';

export interface PackagesTable {
  id: Generated<string>;
  kind: PackageKind;
  title: string;
  launch_path: string;
  manifest: Json;
  size: ColumnType<string, number, number>;
  source_course_id: string | null;
  source_version: number | null;
  created_by: string | null;
  created_at: CreatedAt;
}

export interface LibraryItemsTable {
  id: Generated<string>;
  package_id: string;
  title: string;
  description: ColumnType<string, string | undefined, string>;
  status: ColumnType<'active' | 'archived', 'active' | 'archived' | undefined, 'active' | 'archived'>;
  source_course_id: string | null;
  created_by: string | null;
  created_at: CreatedAt;
  updated_at: DefaultedTimestamp;
}

export interface AssignmentsTable {
  id: Generated<string>;
  library_item_id: string;
  user_id: string | null;
  group_id: string | null;
  due_at: Date | null;
  created_by: string | null;
  created_at: CreatedAt;
}

export type Completion = 'unknown' | 'incomplete' | 'completed';
export type Success = 'unknown' | 'passed' | 'failed';

export interface RegistrationsTable {
  id: Generated<string>;
  user_id: string;
  library_item_id: string;
  package_id: string;
  attempt: number;
  completion: ColumnType<Completion, Completion | undefined, Completion>;
  success: ColumnType<Success, Success | undefined, Success>;
  score_scaled: number | null;
  time_spent_ms: ColumnType<string, number | undefined, number>;
  started_at: DefaultedTimestamp;
  last_activity_at: DefaultedTimestamp;
  completed_at: Date | null;
}

export interface LaunchTokensTable {
  id: Generated<string>;
  token_hash: string;
  registration_id: string;
  user_id: string;
  session_id: string;
  package_id: string;
  mode: ColumnType<string, string | undefined, string>;
  fetch_used: ColumnType<boolean, boolean | undefined, boolean>;
  created_at: CreatedAt;
  expires_at: DefaultedTimestamp;
  absolute_expires_at: DefaultedTimestamp;
  revoked_at: Date | null;
}

export interface ScormRuntimeTable {
  registration_id: string;
  cmi: Json;
  updated_at: DefaultedTimestamp;
}

export interface LrsStatementsTable {
  id: string;
  stored: DefaultedTimestamp;
  statement: Json;
  actor_key: string;
  verb_id: string;
  activity_id: string | null;
  registration: string | null;
  voided: ColumnType<boolean, boolean | undefined, boolean>;
}

export interface LrsDocumentsTable {
  id: Generated<string>;
  kind: 'state' | 'activity_profile' | 'agent_profile';
  activity_id: ColumnType<string, string | undefined, string>;
  agent_key: ColumnType<string, string | undefined, string>;
  registration: ColumnType<string, string | undefined, string>;
  doc_id: string;
  content: Buffer;
  content_type: string;
  etag: string;
  updated_at: DefaultedTimestamp;
}

export interface QuizResponsesTable {
  registration_id: string;
  question_id: string;
  description: ColumnType<string, string | undefined, string>;
  interaction_type: ColumnType<string, string | undefined, string>;
  response: ColumnType<string, string | undefined, string>;
  success: boolean | null;
  score_raw: number | null;
  score_max: number | null;
  needs_manual_grading: ColumnType<boolean, boolean | undefined, boolean>;
  manual_score: number | null;
  graded_by: string | null;
  graded_at: Date | null;
  answered_at: DefaultedTimestamp;
}

export interface AiProvidersTable {
  id: Generated<string>;
  name: string;
  kind: 'anthropic' | 'openai';
  base_url: string;
  model: string;
  enabled: Generated<boolean>;
  allow_user_keys: Generated<boolean>;
  daily_quota: number | null;
  api_key: JSONColumnType<SealedJson | null, string | null | undefined, string | null>;
  api_key_last4: string | null;
  created_at: CreatedAt;
  updated_at: DefaultedTimestamp;
}

export interface AiUserKeysTable {
  user_id: string;
  provider_id: string;
  api_key: JSONColumnType<SealedJson, string, string>;
  last4: string;
  updated_at: DefaultedTimestamp;
}

export interface AiPreviewsTable {
  id: Generated<string>;
  user_id: string;
  provider_id: string;
  course_id: string;
  task: 'rewrite' | 'questions';
  body: string;
  input_chars: number;
  expires_at: Timestamp;
  created_at: CreatedAt;
}

export interface AiUsageTable {
  user_id: string;
  provider_id: string;
  /** Calendar day (UTC), `YYYY-MM-DD`. */
  day: ColumnType<string, string, string>;
  requests: Generated<number>;
}

export interface PasswordResetsTable {
  token_hash: string;
  user_id: string;
  expires_at: Timestamp;
  created_at: CreatedAt;
}

export interface AssignmentNoticesTable {
  assignment_id: string;
  user_id: string;
  kind: 'assigned' | 'reminder';
  sent_at: CreatedAt;
}

export interface CertificatesTable {
  id: Generated<string>;
  serial: string;
  user_id: string;
  registration_id: string;
  library_item_id: string;
  learner_name: string;
  item_title: string;
  score_scaled: number | null;
  /** The result was scored by the server (vs reported by the course content) — F-07. */
  verified: Generated<boolean>;
  completed_at: Timestamp;
  issued_at: CreatedAt;
}

export interface LearningPathsTable {
  id: Generated<string>;
  title: string;
  description: ColumnType<string, string | undefined, string>;
  sequential: ColumnType<boolean, boolean | undefined, boolean>;
  status: ColumnType<'active' | 'archived', 'active' | 'archived' | undefined, 'active' | 'archived'>;
  created_by: string | null;
  created_at: CreatedAt;
  updated_at: DefaultedTimestamp;
}

export interface PathStepsTable {
  path_id: string;
  position: number;
  library_item_id: string;
}

export interface PathAssignmentsTable {
  id: Generated<string>;
  path_id: string;
  user_id: string | null;
  group_id: string | null;
  due_at: Date | null;
  created_by: string | null;
  created_at: CreatedAt;
}

export interface SsoProvidersTable {
  id: Generated<string>;
  kind: 'oidc' | 'saml' | 'ldap' | 'proxy';
  name: string;
  enabled: ColumnType<boolean, boolean | undefined, boolean>;
  config: JSONColumnType<Record<string, unknown>, string, string>;
  secret: JSONColumnType<SealedJson | null, string | null | undefined, string | null>;
  secret_last4: string | null;
  allowed_domains: JSONColumnType<string[], string | undefined, string>;
  auto_create: ColumnType<boolean, boolean | undefined, boolean>;
  default_role: ColumnType<
    'learner' | 'author' | 'trainer',
    'learner' | 'author' | 'trainer' | undefined,
    'learner' | 'author' | 'trainer'
  >;
  email_trusted: ColumnType<boolean, boolean | undefined, boolean>;
  created_at: CreatedAt;
  updated_at: DefaultedTimestamp;
}

export interface DirectoryAttemptsTable {
  provider_id: string;
  account_hash: string;
  failures: ColumnType<number, number | undefined, number>;
  locked_until: Timestamp | null;
  updated_at: DefaultedTimestamp;
}

export interface RateLimitsTable {
  key: string;
  count: number;
  reset_at: Timestamp;
}

export interface PeriodicJobsTable {
  name: string;
  locked_until: Timestamp;
}

export interface PathNoticesTable {
  path_assignment_id: string;
  user_id: string;
  kind: 'assigned' | 'reminder';
  sent_at: DefaultedTimestamp;
}

export interface CourseExportsTable {
  id: Generated<string>;
  course_id: string;
  format: string;
  status: ColumnType<'pending' | 'done' | 'failed', 'pending' | undefined, 'done' | 'failed'>;
  error: string | null;
  file_name: string | null;
  size: ColumnType<string | null, number | null | undefined, number | null>;
  created_by: string | null;
  created_at: CreatedAt;
  finished_at: Timestamp | null;
}

export interface BillingPlansTable {
  id: Generated<string>;
  name: string;
  stripe_price_id: string;
  max_users: number | null;
  max_storage_mb: number | null;
  created_at: CreatedAt;
}

export interface BillingEventsTable {
  id: string;
  type: string;
  tenant_id: string | null;
  outcome: string;
  received_at: CreatedAt;
}

export interface OperatorLogTable {
  id: Generated<string>;
  at: CreatedAt;
  action: string;
  tenant_id: string | null;
  tenant_name: string | null;
  details: JSONColumnType<Record<string, unknown> | null, string | null | undefined, string | null>;
}

export interface GroupManagersTable {
  group_id: string;
  user_id: string;
}

export interface TenantsTable {
  id: Generated<string>;
  name: string;
  public_origin: string | null;
  content_origin: string | null;
  max_users: ColumnType<number | null, number | null | undefined, number | null>;
  max_storage_mb: ColumnType<number | null, number | null | undefined, number | null>;
  contact_name: ColumnType<string | null, string | null | undefined, string | null>;
  contact_email: ColumnType<string | null, string | null | undefined, string | null>;
  plan: ColumnType<string | null, string | null | undefined, string | null>;
  notes: ColumnType<string | null, string | null | undefined, string | null>;
  plan_id: ColumnType<string | null, string | null | undefined, string | null>;
  stripe_customer_id: ColumnType<string | null, string | null | undefined, string | null>;
  stripe_subscription_id: ColumnType<string | null, string | null | undefined, string | null>;
  billing_state: ColumnType<
    'active' | 'past_due' | 'canceled' | null,
    'active' | 'past_due' | 'canceled' | null | undefined,
    'active' | 'past_due' | 'canceled' | null
  >;
  status: ColumnType<'active' | 'disabled', 'active' | 'disabled' | undefined, 'active' | 'disabled'>;
  created_at: CreatedAt;
}

export interface SsoStatesTable {
  state_hash: string;
  provider_id: string;
  binder_hash: string;
  nonce: string | null;
  code_verifier: JSONColumnType<SealedJson | null, string | null | undefined, string | null>;
  expires_at: Timestamp;
}

export interface UserIdentitiesTable {
  provider_id: string;
  subject: string;
  user_id: string;
  created_at: CreatedAt;
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
  courses: CoursesTable;
  course_members: CourseMembersTable;
  course_nodes: CourseNodesTable;
  assets: AssetsTable;
  course_assets: CourseAssetsTable;
  course_locks: CourseLocksTable;
  course_versions: CourseVersionsTable;
  conversions: ConversionsTable;
  packages: PackagesTable;
  library_items: LibraryItemsTable;
  assignments: AssignmentsTable;
  registrations: RegistrationsTable;
  launch_tokens: LaunchTokensTable;
  scorm_runtime: ScormRuntimeTable;
  lrs_statements: LrsStatementsTable;
  lrs_documents: LrsDocumentsTable;
  quiz_responses: QuizResponsesTable;
  ai_providers: AiProvidersTable;
  ai_user_keys: AiUserKeysTable;
  ai_previews: AiPreviewsTable;
  ai_usage: AiUsageTable;
  password_resets: PasswordResetsTable;
  assignment_notices: AssignmentNoticesTable;
  certificates: CertificatesTable;
  learning_paths: LearningPathsTable;
  path_steps: PathStepsTable;
  path_assignments: PathAssignmentsTable;
  sso_providers: SsoProvidersTable;
  sso_states: SsoStatesTable;
  directory_attempts: DirectoryAttemptsTable;
  rate_limits: RateLimitsTable;
  periodic_jobs: PeriodicJobsTable;
  tenants: TenantsTable;
  group_managers: GroupManagersTable;
  operator_log: OperatorLogTable;
  billing_plans: BillingPlansTable;
  billing_events: BillingEventsTable;
  course_exports: CourseExportsTable;
  path_notices: PathNoticesTable;
  user_identities: UserIdentitiesTable;
}
