// SPDX-License-Identifier: Apache-2.0
import {
  importUsersResponseSchema,
  listGroupsResponseSchema,
  listUsersResponseSchema,
  okSchema,
  PASSWORD_MIN_LENGTH,
  ROLES,
  userSchema,
  type Group,
  type Locale,
  type Role,
  type User,
} from '@lernwerk/shared';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { z } from 'zod';
import { api, download } from '../api/client.js';
import { useSession } from '../api/session.js';
import { Badge } from '../components/Badge.js';
import { Button, ToolButton } from '../components/Button.js';
import { DataTable, type Selection, type SortDescriptor } from '../components/DataTable.js';
import { Dialog } from '../components/Dialog.js';
import { Checkbox, FormGrid, FormRow, SelectField, TextField } from '../components/Field.js';
import { Notice } from '../components/Notice.js';
import { Page, ToolbarSeparator, ToolbarSpacer } from '../components/Page.js';
import { errorMessage } from '../lib/errors.js';
import { formatDateTime, formatNumber } from '../lib/format.js';
import { useApi } from '../lib/useApi.js';
import styles from './AdminPages.module.css';

const PAGE_SIZE = 50;
const EMPTY_USERS: User[] = [];
const EMPTY_GROUPS: Group[] = [];
const SORT_KEYS = { name: 'name', email: 'email', created: 'created', lastLogin: 'lastLogin' } as const;

type ImportResult = z.infer<typeof importUsersResponseSchema>;

function RolesPicker({ value, onChange }: { value: Role[]; onChange: (roles: Role[]) => void }) {
  const { t } = useTranslation();
  return (
    <div className={styles.checks}>
      {ROLES.map((role) => (
        <Checkbox
          key={role}
          isSelected={value.includes(role)}
          onChange={(on) => onChange(on ? [...value, role] : value.filter((r) => r !== role))}
        >
          {t(`roles.${role}`)}
        </Checkbox>
      ))}
    </div>
  );
}

function GroupsPicker({
  groups,
  value,
  onChange,
}: {
  groups: Group[];
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const { t } = useTranslation();
  if (!groups.length) return <span className={styles.muted}>{t('groups.none')}</span>;
  return (
    <div className={styles.checks}>
      {groups.map((g) => (
        <Checkbox
          key={g.id}
          isSelected={value.includes(g.id)}
          onChange={(on) => onChange(on ? [...value, g.id] : value.filter((id) => id !== g.id))}
        >
          {g.name}
        </Checkbox>
      ))}
    </div>
  );
}

function UserDialog({
  user,
  groups,
  onClose,
  onSaved,
}: {
  user: User | null;
  groups: Group[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [email, setEmail] = useState(user?.email ?? '');
  const [name, setName] = useState(user?.displayName ?? '');
  const [locale, setLocale] = useState<Locale>(user?.locale ?? 'de');
  const [roles, setRoles] = useState<Role[]>(user?.roles ?? ['learner']);
  const [groupIds, setGroupIds] = useState<string[]>(user?.groups.map((g) => g.id) ?? []);
  const [status, setStatus] = useState<'active' | 'disabled'>(user?.status ?? 'active');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    try {
      if (user) {
        await api(userSchema, `/api/users/${user.id}`, {
          method: 'PATCH',
          body: { email, displayName: name, locale, roles, groupIds, status },
        });
      } else {
        await api(userSchema, '/api/users', {
          method: 'POST',
          body: { email, displayName: name, locale, roles, groupIds, password },
        });
      }
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <Dialog
      title={user ? t('users.edit') : t('users.new')}
      isOpen
      onClose={onClose}
      onSubmit={() => void save()}
      footer={
        <>
          <Button onPress={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary">
            {t('common.save')}
          </Button>
        </>
      }
    >
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <FormGrid>
        <TextField label={t('fields.displayName')} value={name} onChange={setName} isRequired autoFocus />
        <TextField label={t('fields.email')} type="email" value={email} onChange={setEmail} isRequired />
        {user ? null : (
          <TextField
            label={t('users.initialPassword')}
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            description={t('users.initialPasswordHint', { min: PASSWORD_MIN_LENGTH })}
            isRequired
          />
        )}
        <SelectField
          label={t('fields.language')}
          value={locale}
          onChange={setLocale}
          options={[
            { id: 'de', label: 'Deutsch' },
            { id: 'en', label: 'English' },
          ]}
        />
        <FormRow label={t('users.roles')}>
          <RolesPicker value={roles} onChange={setRoles} />
        </FormRow>
        <FormRow label={t('users.groups')}>
          <GroupsPicker groups={groups} value={groupIds} onChange={setGroupIds} />
        </FormRow>
        {user ? (
          <SelectField
            label={t('users.status')}
            value={status}
            onChange={setStatus}
            options={[
              { id: 'active', label: t('users.active') },
              { id: 'disabled', label: t('users.disabled') },
            ]}
          />
        ) : null}
      </FormGrid>
    </Dialog>
  );
}

function ResetPasswordDialog({ user, onClose }: { user: User; onClose: () => void }) {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    try {
      await api(okSchema, `/api/users/${user.id}/reset-password`, { method: 'POST', body: { password } });
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <Dialog
      title={t('users.resetPasswordFor', { name: user.displayName })}
      isOpen
      onClose={onClose}
      width="sm"
      onSubmit={() => void save()}
      footer={
        <>
          <Button onPress={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary">
            {t('users.resetPassword')}
          </Button>
        </>
      }
    >
      <Notice tone="warning">{t('users.resetPasswordHint')}</Notice>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <FormGrid>
        <TextField
          label={t('password.new')}
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          isRequired
          autoFocus
        />
      </FormGrid>
    </Dialog>
  );
}

function ConfirmDialog({
  title,
  text,
  action,
  onConfirm,
  onClose,
}: {
  title: string;
  text: string;
  action: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog
      title={title}
      isOpen
      onClose={onClose}
      width="sm"
      footer={
        <>
          <Button onPress={onClose} autoFocus>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" onPress={onConfirm}>
            {action}
          </Button>
        </>
      }
    >
      <p>{text}</p>
    </Dialog>
  );
}

function ImportDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const [csv, setCsv] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (dryRun: boolean) => {
    setError(null);
    try {
      const res = await api(importUsersResponseSchema, '/api/users/import', {
        method: 'POST',
        query: { dryRun },
        text: { content: csv, type: 'text/csv' },
      });
      setResult(res);
      if (!dryRun) onDone();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const created = result?.rows.filter((r) => r.initialPassword) ?? [];
  const passwordsCsv = [
    'email,initial_password',
    ...created.map((r) => `${r.email},${r.initialPassword ?? ''}`),
  ].join('\n');

  return (
    <Dialog
      title={t('users.import')}
      isOpen
      onClose={onClose}
      width="lg"
      footer={
        <>
          <Button onPress={onClose}>{t('common.close')}</Button>
          <Button onPress={() => void run(true)} isDisabled={!csv}>
            {t('users.importCheck')}
          </Button>
          <Button variant="primary" onPress={() => void run(false)} isDisabled={!csv || !result?.dryRun}>
            {t('users.importRun')}
          </Button>
        </>
      }
    >
      <Notice>{t('users.importHint')}</Notice>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <label className={styles.fileLabel}>
        {t('users.importFile')}{' '}
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file)
              void file.text().then((text) => {
                setCsv(text);
                setResult(null);
              });
          }}
        />
      </label>
      {result ? (
        <div className={styles.importResult}>
          <DataTable
            label={t('users.importResult')}
            rows={result.rows.map((r) => ({ ...r, id: String(r.line) }))}
            empty="–"
            columns={[
              { id: 'line', label: t('users.line'), numeric: true, render: (r) => r.line },
              { id: 'email', label: t('fields.email'), isRowHeader: true, render: (r) => r.email },
              {
                id: 'status',
                label: t('users.status'),
                render: (r) => (
                  <Badge
                    tone={r.status === 'created' ? 'success' : r.status === 'exists' ? 'warning' : 'danger'}
                  >
                    {t(`users.importStatus.${r.status}`)}
                  </Badge>
                ),
              },
              { id: 'message', label: t('users.message'), render: (r) => r.message ?? '' },
            ]}
          />
        </div>
      ) : null}
      {created.length ? (
        <Notice tone="warning">
          {t('users.importPasswords')}{' '}
          <Button
            icon="download"
            onPress={() => {
              const url = URL.createObjectURL(new Blob([passwordsCsv], { type: 'text/csv' }));
              const link = document.createElement('a');
              link.href = url;
              link.download = 'lernwerk-initial-passwords.csv';
              link.click();
              URL.revokeObjectURL(url);
            }}
          >
            {t('users.downloadPasswords')}
          </Button>
        </Notice>
      ) : null}
    </Dialog>
  );
}

export function UsersPage() {
  const { t } = useTranslation();
  const { session } = useSession();
  const [q, setQ] = useState('');
  const [role, setRole] = useState<Role | 'all'>('all');
  const [status, setStatus] = useState<'all' | 'active' | 'disabled'>('all');
  const [sort, setSort] = useState<SortDescriptor>({ column: 'name', direction: 'ascending' });
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Selection>(new Set());
  const [dialog, setDialog] = useState<null | 'new' | 'edit' | 'reset' | 'delete' | 'import'>(null);
  const [actionError, setError] = useState<string | null>(null);

  const fetchUsers = useCallback(() => {
    const sortKey = SORT_KEYS[String(sort.column) as keyof typeof SORT_KEYS] ?? 'name';
    return api(listUsersResponseSchema, '/api/users', {
      query: {
        q,
        role: role === 'all' ? undefined : role,
        status: status === 'all' ? undefined : status,
        sort: sortKey,
        dir: sort.direction === 'descending' ? 'desc' : 'asc',
        page,
        pageSize: PAGE_SIZE,
      },
    });
  }, [q, role, status, sort, page]);
  const usersQuery = useApi(fetchUsers);
  const users = usersQuery.data?.items ?? EMPTY_USERS;
  const total = usersQuery.data?.total ?? 0;
  const load = usersQuery.reload;
  const error = actionError ?? usersQuery.error;
  const fetchGroups = useCallback(
    () => api(listGroupsResponseSchema, '/api/groups').then((r) => r.items),
    [],
  );
  const groups = useApi(fetchGroups).data ?? EMPTY_GROUPS;

  const current = useMemo(() => {
    if (selected === 'all' || selected.size !== 1) return null;
    const [id] = [...selected];
    return users.find((u) => u.id === id) ?? null;
  }, [selected, users]);

  const done = () => {
    setDialog(null);
    load();
  };

  const remove = async () => {
    if (!current) return;
    try {
      await api(okSchema, `/api/users/${current.id}`, { method: 'DELETE' });
      setSelected(new Set());
      done();
    } catch (e) {
      setDialog(null);
      setError(errorMessage(e));
    }
  };

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <Page
      title={t('users.title')}
      meta={t('users.count', { count: total, formatted: formatNumber(total) })}
      toolbar={
        <>
          <ToolButton icon="user-plus" onPress={() => setDialog('new')}>
            {t('users.new')}
          </ToolButton>
          <ToolButton icon="file-up" onPress={() => setDialog('import')}>
            {t('users.import')}
          </ToolButton>
          <ToolbarSeparator />
          <ToolButton icon="pencil" isDisabled={!current} onPress={() => setDialog('edit')}>
            {t('users.edit')}
          </ToolButton>
          <ToolButton icon="key-round" isDisabled={!current} onPress={() => setDialog('reset')}>
            {t('users.resetPassword')}
          </ToolButton>
          <ToolButton
            icon="download"
            isDisabled={!current}
            onPress={() =>
              current && void download(`/api/users/${current.id}/export`, `lernwerk-${current.id}.json`)
            }
          >
            {t('privacy.export')}
          </ToolButton>
          <ToolButton
            icon="trash-2"
            isDisabled={!current || current.id === session?.user.id}
            onPress={() => setDialog('delete')}
          >
            {t('users.delete')}
          </ToolButton>
          <ToolbarSpacer />
          <div className={styles.filter}>
            <TextField
              label={t('common.search')}
              type="search"
              value={q}
              onChange={(v) => {
                setQ(v);
                setPage(1);
              }}
            />
          </div>
          <div className={styles.filter}>
            <SelectField
              label={t('users.role')}
              value={role}
              onChange={(v) => {
                setRole(v);
                setPage(1);
              }}
              options={[
                { id: 'all', label: t('common.all') },
                ...ROLES.map((r) => ({ id: r, label: t(`roles.${r}`) })),
              ]}
            />
          </div>
          <div className={styles.filter}>
            <SelectField
              label={t('users.status')}
              value={status}
              onChange={(v) => {
                setStatus(v);
                setPage(1);
              }}
              options={[
                { id: 'all', label: t('common.all') },
                { id: 'active', label: t('users.active') },
                { id: 'disabled', label: t('users.disabled') },
              ]}
            />
          </div>
        </>
      }
      footer={
        <>
          <span>{t('common.pageOf', { page, pages })}</span>
          <ToolButton
            icon="chevron-left"
            aria-label={t('common.previousPage')}
            isDisabled={page <= 1}
            onPress={() => setPage(page - 1)}
          />
          <ToolButton
            icon="chevron-right"
            aria-label={t('common.nextPage')}
            isDisabled={page >= pages}
            onPress={() => setPage(page + 1)}
          />
        </>
      }
    >
      <div className={styles.stack}>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <DataTable
          label={t('users.title')}
          rows={users}
          sort={sort}
          onSortChange={(s) => {
            setSort(s);
            setPage(1);
          }}
          selectionMode="single"
          selected={selected}
          onSelectionChange={setSelected}
          onRowAction={(id) => {
            setSelected(new Set([id]));
            setDialog('edit');
          }}
          empty={t('users.empty')}
          columns={[
            {
              id: 'name',
              label: t('fields.displayName'),
              sortable: true,
              isRowHeader: true,
              render: (u) => u.displayName,
            },
            { id: 'email', label: t('fields.email'), sortable: true, render: (u) => u.email },
            {
              id: 'roles',
              label: t('users.roles'),
              render: (u) => u.roles.map((r) => t(`roles.${r}`)).join(', '),
            },
            { id: 'groups', label: t('users.groups'), render: (u) => u.groups.map((g) => g.name).join(', ') },
            {
              id: 'status',
              label: t('users.status'),
              render: (u) =>
                u.status === 'active' ? (
                  <Badge tone="success">{t('users.active')}</Badge>
                ) : (
                  <Badge>{t('users.disabled')}</Badge>
                ),
            },
            {
              id: 'totp',
              label: t('totp.short'),
              render: (u) => (u.totpEnabled ? t('common.yes') : t('common.no')),
            },
            {
              id: 'lastLogin',
              label: t('users.lastLogin'),
              sortable: true,
              numeric: true,
              render: (u) => formatDateTime(u.lastLoginAt),
            },
            {
              id: 'created',
              label: t('users.created'),
              sortable: true,
              numeric: true,
              render: (u) => formatDateTime(u.createdAt),
            },
          ]}
        />
      </div>

      {dialog === 'new' ? (
        <UserDialog user={null} groups={groups} onClose={() => setDialog(null)} onSaved={done} />
      ) : null}
      {dialog === 'edit' && current ? (
        <UserDialog user={current} groups={groups} onClose={() => setDialog(null)} onSaved={done} />
      ) : null}
      {dialog === 'reset' && current ? (
        <ResetPasswordDialog user={current} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === 'import' ? <ImportDialog onClose={() => setDialog(null)} onDone={load} /> : null}
      {dialog === 'delete' && current ? (
        <ConfirmDialog
          title={t('users.delete')}
          text={t('users.deleteConfirm', { name: current.displayName })}
          action={t('users.delete')}
          onConfirm={() => void remove()}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </Page>
  );
}

export { ConfirmDialog };
