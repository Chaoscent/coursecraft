// SPDX-License-Identifier: Apache-2.0
import {
  okSchema,
  operatorCreatedSchema,
  operatorInstallationSchema,
  operatorLogSchema,
  operatorResetLinkSchema,
  operatorSessionSchema,
  operatorSetupTokenSchema,
  operatorTenantDetailSchema,
  operatorTenantsSchema,
  type OperatorTenant,
} from '@coursecraft/shared';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, setCsrfToken } from '../api/client.js';
import { Badge } from '../components/Badge.js';
import { Button, ToolButton } from '../components/Button.js';
import { DataTable, type Selection } from '../components/DataTable.js';
import { Dialog } from '../components/Dialog.js';
import { FormGrid, TextField } from '../components/Field.js';
import { Icon } from '../components/Icon.js';
import { Notice } from '../components/Notice.js';
import { Page, ToolbarSeparator } from '../components/Page.js';
import { AuthFrame } from '../layout/AuthFrame.js';
import { errorMessage } from '../lib/errors.js';
import { formatDateTime } from '../lib/format.js';
import { useApi } from '../lib/useApi.js';
import styles from './OperatorApp.module.css';

const limitOf = (text: string): number | null => {
  const n = Number.parseInt(text.trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

function size(bytes: number, locale: string): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 1024
    ? `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(mb / 1024)} GB`
    : `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(mb)} MB`;
}

function Login({ onSignedIn }: { onSignedIn: () => void }) {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    try {
      const session = await api(operatorSessionSchema, '/api/operator/login', {
        method: 'POST',
        body: { password },
      });
      setCsrfToken(session.csrfToken);
      onSignedIn();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <AuthFrame
        title={t('operator.signIn')}
        footer={
          <Button type="submit" variant="primary">
            {t('login.submit')}
          </Button>
        }
      >
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <Notice tone="info">{t('operator.signInHint')}</Notice>
        <FormGrid>
          <TextField
            label={t('fields.password')}
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            isRequired
            autoFocus
          />
        </FormGrid>
      </AuthFrame>
    </form>
  );
}

interface Secret {
  title: string;
  hint: string;
  value: string;
}

function TenantDialog({
  tenant,
  onClose,
  onSaved,
}: {
  tenant: OperatorTenant | null;
  onClose: () => void;
  onSaved: (secret?: Secret) => void;
}) {
  const { t, i18n } = useTranslation();
  const [name, setName] = useState(tenant?.name ?? '');
  const [publicOrigin, setPublicOrigin] = useState(tenant?.publicOrigin ?? 'https://');
  const [contentOrigin, setContentOrigin] = useState(tenant?.contentOrigin ?? 'https://');
  const [contactName, setContactName] = useState(tenant?.contactName ?? '');
  const [contactEmail, setContactEmail] = useState(tenant?.contactEmail ?? '');
  const [plan, setPlan] = useState(tenant?.plan ?? '');
  const [notes, setNotes] = useState(tenant?.notes ?? '');
  const [maxUsers, setMaxUsers] = useState(tenant?.maxUsers ? String(tenant.maxUsers) : '');
  const [maxStorage, setMaxStorage] = useState(tenant?.maxStorageMb ? String(tenant.maxStorageMb) : '');
  const [error, setError] = useState<string | null>(null);
  const addresses = !tenant?.isDefault;
  const save = async () => {
    try {
      const details = {
        contactName,
        contactEmail,
        plan,
        notes,
        maxUsers: limitOf(maxUsers),
        maxStorageMb: limitOf(maxStorage),
      };
      if (tenant) {
        await api(okSchema, `/api/operator/tenants/${tenant.id}`, {
          method: 'PATCH',
          body: { name, ...(addresses ? { publicOrigin, contentOrigin } : {}), ...details },
        });
        onSaved();
      } else {
        const created = await api(operatorCreatedSchema, '/api/operator/tenants', {
          method: 'POST',
          body: {
            name,
            publicOrigin,
            contentOrigin,
            maxUsers: details.maxUsers,
            maxStorageMb: details.maxStorageMb,
          },
        });
        await api(okSchema, `/api/operator/tenants/${created.id}`, {
          method: 'PATCH',
          body: { contactName, contactEmail, plan, notes },
        });
        onSaved({
          title: t('operator.tokenTitle'),
          hint: t('operator.tokenHint', {
            url: `${publicOrigin.replace(/\/+$/, '')}/setup`,
            until: new Date(created.expiresAt).toLocaleString(i18n.language),
          }),
          value: created.token,
        });
      }
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <Dialog
      title={tenant ? t('operator.edit') : t('operator.new')}
      isOpen
      width="lg"
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
      <FormGrid wide>
        <TextField label={t('operator.name')} value={name} onChange={setName} isRequired autoFocus />
        {addresses ? (
          <>
            <TextField
              label={t('operator.publicOrigin')}
              value={publicOrigin}
              onChange={setPublicOrigin}
              isRequired
              description={t('operator.publicOriginHint')}
            />
            <TextField
              label={t('operator.contentOrigin')}
              value={contentOrigin}
              onChange={setContentOrigin}
              isRequired
              description={t('operator.contentOriginHint')}
            />
          </>
        ) : null}
        <TextField label={t('operator.contactName')} value={contactName} onChange={setContactName} />
        <TextField
          label={t('operator.contactEmail')}
          type="email"
          value={contactEmail}
          onChange={setContactEmail}
        />
        <TextField
          label={t('operator.plan')}
          value={plan}
          onChange={setPlan}
          description={t('operator.planHint')}
        />
        <TextField
          label={t('operator.maxUsers')}
          value={maxUsers}
          onChange={setMaxUsers}
          description={t('operator.unlimitedHint')}
        />
        <TextField
          label={t('operator.maxStorage')}
          value={maxStorage}
          onChange={setMaxStorage}
          description={t('operator.unlimitedHint')}
        />
        <TextField
          label={t('operator.notes')}
          multiline
          value={notes}
          onChange={setNotes}
          description={t('operator.notesHint')}
        />
      </FormGrid>
    </Dialog>
  );
}

function SecretDialog({ secret, onClose }: { secret: Secret; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Dialog
      title={secret.title}
      isOpen
      width="md"
      onClose={onClose}
      footer={
        <Button variant="primary" onPress={onClose}>
          {t('common.close')}
        </Button>
      }
    >
      <Notice tone="info">{secret.hint}</Notice>
      <div className={styles.token}>{secret.value}</div>
    </Dialog>
  );
}

function DeleteDialog({
  tenant,
  onClose,
  onDeleted,
}: {
  tenant: OperatorTenant;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { t } = useTranslation();
  const [confirmName, setConfirmName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const remove = async () => {
    try {
      await api(okSchema, `/api/operator/tenants/${tenant.id}/delete`, {
        method: 'POST',
        body: { confirmName },
      });
      onDeleted();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <Dialog
      title={t('operator.delete')}
      isOpen
      width="sm"
      onClose={onClose}
      onSubmit={() => void remove()}
      footer={
        <>
          <Button onPress={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="danger" isDisabled={confirmName !== tenant.name}>
            {t('operator.deleteForGood')}
          </Button>
        </>
      }
    >
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Notice tone="warning">{t('operator.deleteWarning', { name: tenant.name })}</Notice>
      <FormGrid>
        <TextField label={t('operator.typeName')} value={confirmName} onChange={setConfirmName} autoFocus />
      </FormGrid>
    </Dialog>
  );
}

const limited = (used: string, max: string | null) => (max ? `${used} / ${max}` : used);

/** Details of one organisation: contact, addresses, usage, administrators, notes. */
function TenantSide({ tenant, onSecret }: { tenant: OperatorTenant; onSecret: (secret: Secret) => void }) {
  const { t, i18n } = useTranslation();
  const fetcher = useCallback(
    () => api(operatorTenantDetailSchema, `/api/operator/tenants/${tenant.id}/detail`),
    [tenant.id],
  );
  const { data: detail, error } = useApi(fetcher);
  const [actionError, setActionError] = useState<string | null>(null);
  const resetLink = (id: string, name: string) =>
    void api(operatorResetLinkSchema, `/api/operator/tenants/${tenant.id}/admins/${id}/reset-link`, {
      method: 'POST',
    })
      .then((r) =>
        onSecret({
          title: t('operator.resetTitle', { name }),
          hint: t('operator.resetHint', { until: new Date(r.expiresAt).toLocaleString(i18n.language) }),
          value: r.link,
        }),
      )
      .catch((e: unknown) => setActionError(errorMessage(e)));
  return (
    <aside className={styles.side} aria-label={t('operator.details')}>
      <h2>{tenant.name}</h2>
      {(error ?? actionError) ? <Notice tone="danger">{error ?? actionError}</Notice> : null}
      <dl className={styles.facts}>
        <dt>{t('ai.status')}</dt>
        <dd>
          <Badge tone={tenant.status === 'active' ? 'success' : 'neutral'}>
            {tenant.status === 'active' ? t('operator.active') : t('operator.disabled')}
          </Badge>
        </dd>
        <dt>{t('operator.plan')}</dt>
        <dd>{tenant.plan ?? '–'}</dd>
        <dt>{t('operator.contactName')}</dt>
        <dd>{tenant.contactName ?? '–'}</dd>
        <dt>{t('operator.contactEmail')}</dt>
        <dd>{tenant.contactEmail ?? '–'}</dd>
        <dt>{t('operator.publicOrigin')}</dt>
        <dd>{tenant.publicOrigin ?? t('operator.installationAddress')}</dd>
        <dt>{t('operator.contentOrigin')}</dt>
        <dd>{tenant.contentOrigin ?? '–'}</dd>
        <dt>{t('operator.created')}</dt>
        <dd>{formatDateTime(tenant.createdAt)}</dd>
      </dl>
      <h3>{t('operator.usage')}</h3>
      {detail ? (
        <dl className={styles.facts}>
          <dt>{t('operator.users')}</dt>
          <dd>{limited(String(detail.users), tenant.maxUsers ? String(tenant.maxUsers) : null)}</dd>
          <dt>{t('operator.active30')}</dt>
          <dd>{detail.activeUsers30d}</dd>
          <dt>{t('operator.courses')}</dt>
          <dd>{detail.courses}</dd>
          <dt>{t('operator.libraryItems')}</dt>
          <dd>{detail.libraryItems}</dd>
          <dt>{t('operator.storage')}</dt>
          <dd>
            {limited(
              size(detail.storageBytes, i18n.language),
              tenant.maxStorageMb ? size(tenant.maxStorageMb * 1024 * 1024, i18n.language) : null,
            )}
          </dd>
          <dt>{t('operator.lastSignIn')}</dt>
          <dd>{detail.lastSignInAt ? formatDateTime(detail.lastSignInAt) : '–'}</dd>
        </dl>
      ) : null}
      <h3>{t('operator.admins')}</h3>
      {detail && detail.admins.length === 0 ? <p className={styles.muted}>{t('operator.noAdmins')}</p> : null}
      {detail?.admins.map((a) => (
        <div key={a.id} className={styles.admin}>
          <span>
            {a.displayName}
            <br />
            <span className={styles.muted}>{a.email}</span>
          </span>
          <ToolButton icon="key-round" onPress={() => resetLink(a.id, a.displayName)}>
            {t('operator.resetLink')}
          </ToolButton>
        </div>
      ))}
      <h3>{t('operator.notes')}</h3>
      <p className={tenant.notes ? styles.notes : styles.muted}>{tenant.notes ?? t('operator.noNotes')}</p>
    </aside>
  );
}

function TenantsView() {
  const { t, i18n } = useTranslation();
  const [selected, setSelected] = useState<Selection>(new Set());
  const [dialog, setDialog] = useState<null | 'new' | 'edit' | 'delete'>(null);
  const [secret, setSecret] = useState<Secret | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fetcher = useCallback(
    () => api(operatorTenantsSchema, '/api/operator/tenants').then((r) => r.items),
    [],
  );
  const { data, reload, error: loadError } = useApi(fetcher);
  const tenants = useMemo(() => data ?? [], [data]);
  const current = useMemo(() => {
    if (selected === 'all' || selected.size !== 1) return null;
    const [id] = [...selected];
    return tenants.find((x) => x.id === id) ?? null;
  }, [selected, tenants]);
  const fail = (e: unknown) => setError(errorMessage(e));

  const toggle = () => {
    if (!current) return;
    void api(okSchema, `/api/operator/tenants/${current.id}`, {
      method: 'PATCH',
      body: { status: current.status === 'active' ? 'disabled' : 'active' },
    })
      .then(reload)
      .catch(fail);
  };
  const newToken = () => {
    if (!current) return;
    void api(operatorSetupTokenSchema, `/api/operator/tenants/${current.id}/setup-token`, { method: 'POST' })
      .then((r) =>
        setSecret({
          title: t('operator.tokenTitle'),
          hint: t('operator.tokenHint', {
            url: `${current.publicOrigin ?? ''}/setup`,
            until: new Date(r.expiresAt).toLocaleString(i18n.language),
          }),
          value: r.token,
        }),
      )
      .catch(fail);
  };

  return (
    <Page
      title={t('operator.title')}
      meta={t('operator.count', { count: tenants.length })}
      toolbar={
        <>
          <ToolButton icon="folder-plus" onPress={() => setDialog('new')}>
            {t('operator.new')}
          </ToolButton>
          <ToolbarSeparator />
          <ToolButton icon="pencil" isDisabled={!current} onPress={() => setDialog('edit')}>
            {t('operator.edit')}
          </ToolButton>
          <ToolButton icon="key-round" isDisabled={!current || current.isDefault} onPress={newToken}>
            {t('operator.newToken')}
          </ToolButton>
          <ToolButton icon="circle-x" isDisabled={!current || current.isDefault} onPress={toggle}>
            {current?.status === 'disabled' ? t('operator.enable') : t('operator.disable')}
          </ToolButton>
          <ToolButton
            icon="trash-2"
            isDisabled={!current || current.isDefault}
            onPress={() => setDialog('delete')}
          >
            {t('operator.delete')}
          </ToolButton>
        </>
      }
    >
      <div className={current ? styles.split : undefined}>
        <div className={styles.stack}>
          {(error ?? loadError) ? <Notice tone="danger">{error ?? loadError}</Notice> : null}
          <DataTable
            label={t('operator.title')}
            rows={tenants}
            selectionMode="single"
            selected={selected}
            onSelectionChange={setSelected}
            empty={t('operator.empty')}
            columns={[
              {
                id: 'name',
                label: t('operator.name'),
                isRowHeader: true,
                render: (x) => (x.isDefault ? `${x.name} (${t('operator.default')})` : x.name),
              },
              { id: 'plan', label: t('operator.plan'), render: (x) => x.plan ?? '–' },
              { id: 'origin', label: t('operator.publicOrigin'), render: (x) => x.publicOrigin ?? '–' },
              {
                id: 'status',
                label: t('ai.status'),
                render: (x) => (
                  <Badge tone={x.status === 'active' ? 'success' : 'neutral'}>
                    {x.status === 'active' ? t('operator.active') : t('operator.disabled')}
                  </Badge>
                ),
              },
              {
                id: 'users',
                label: t('operator.users'),
                numeric: true,
                render: (x) => limited(String(x.users), x.maxUsers ? String(x.maxUsers) : null),
              },
              {
                id: 'storage',
                label: t('operator.storage'),
                numeric: true,
                render: (x) =>
                  limited(
                    size(x.storageBytes, i18n.language),
                    x.maxStorageMb ? size(x.maxStorageMb * 1024 * 1024, i18n.language) : null,
                  ),
              },
            ]}
          />
        </div>
        {current ? <TenantSide key={current.id} tenant={current} onSecret={setSecret} /> : null}
      </div>
      {dialog === 'new' ? (
        <TenantDialog
          tenant={null}
          onClose={() => setDialog(null)}
          onSaved={(created) => {
            setDialog(null);
            if (created) setSecret(created);
            reload();
          }}
        />
      ) : null}
      {dialog === 'edit' && current ? (
        <TenantDialog
          tenant={current}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            reload();
          }}
        />
      ) : null}
      {dialog === 'delete' && current ? (
        <DeleteDialog
          tenant={current}
          onClose={() => setDialog(null)}
          onDeleted={() => {
            setDialog(null);
            setSelected(new Set());
            reload();
          }}
        />
      ) : null}
      {secret ? <SecretDialog secret={secret} onClose={() => setSecret(null)} /> : null}
    </Page>
  );
}

function InstallationView() {
  const { t, i18n } = useTranslation();
  const fetcher = useCallback(() => api(operatorInstallationSchema, '/api/operator/installation'), []);
  const { data, error } = useApi(fetcher);
  return (
    <Page title={t('operator.installation')}>
      <div className={styles.stack}>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        {data ? (
          <dl className={styles.facts}>
            <dt>{t('operator.version')}</dt>
            <dd>{data.version}</dd>
            <dt>{t('operator.mode')}</dt>
            <dd>{data.tenancy === 'multi' ? t('operator.modeMulti') : t('operator.modeSingle')}</dd>
            <dt>{t('operator.storageKind')}</dt>
            <dd>{data.storage === 's3' ? t('operator.storageS3') : t('operator.storageFs')}</dd>
            <dt>{t('operator.schema')}</dt>
            <dd>{data.migration}</dd>
            <dt>{t('operator.title')}</dt>
            <dd>
              {data.activeOrganisations} / {data.organisations}
            </dd>
            <dt>{t('operator.users')}</dt>
            <dd>{data.users}</dd>
            <dt>{t('operator.storage')}</dt>
            <dd>{size(data.storageBytes, i18n.language)}</dd>
          </dl>
        ) : null}
        <Notice tone="info">{t('operator.installationHint')}</Notice>
      </div>
    </Page>
  );
}

function LogView() {
  const { t, i18n } = useTranslation();
  const fetcher = useCallback(() => api(operatorLogSchema, '/api/operator/log').then((r) => r.items), []);
  const { data, error } = useApi(fetcher);
  return (
    <Page title={t('operator.log')} meta={t('operator.logCount', { count: data?.length ?? 0 })}>
      <div className={styles.stack}>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <DataTable
          label={t('operator.log')}
          rows={data ?? []}
          empty={t('operator.logEmpty')}
          columns={[
            { id: 'at', label: t('operator.at'), isRowHeader: true, render: (e) => formatDateTime(e.at) },
            {
              id: 'action',
              label: t('operator.action'),
              render: (e) =>
                i18n.exists(`operator.actions.${e.action}`) ? t(`operator.actions.${e.action}`) : e.action,
            },
            { id: 'tenant', label: t('operator.name'), render: (e) => e.tenantName ?? '–' },
            {
              id: 'details',
              label: t('operator.changed'),
              render: (e) => {
                const fields = e.details?.['fields'];
                return Array.isArray(fields) ? fields.join(', ') : '';
              },
            },
          ]}
        />
      </div>
    </Page>
  );
}

type View = 'tenants' | 'installation' | 'log';

function Console({ onSignedOut }: { onSignedOut: () => void }) {
  const { t } = useTranslation();
  const [view, setView] = useState<View>('tenants');
  const signOut = () => {
    void api(okSchema, '/api/operator/logout', { method: 'POST' }).finally(() => {
      setCsrfToken(null);
      onSignedOut();
    });
  };
  const items: { id: View; icon: string; label: string }[] = [
    { id: 'tenants', icon: 'folder', label: t('operator.title') },
    { id: 'installation', icon: 'database', label: t('operator.installation') },
    { id: 'log', icon: 'history', label: t('operator.log') },
  ];
  return (
    <div className={styles.app}>
      <nav className={styles.menubar} aria-label={t('shell.mainMenu')}>
        <span className={styles.brand}>{t('operator.brand')}</span>
        <span className={styles.spacer} />
        <ToolButton icon="log-out" onPress={signOut}>
          {t('menu.logout')}
        </ToolButton>
      </nav>
      <div className={styles.body}>
        <aside className={styles.nav} aria-label={t('shell.navigation')}>
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className={styles.navItem}
              aria-current={view === item.id ? 'page' : undefined}
              onClick={() => setView(item.id)}
            >
              <Icon name={item.icon} />
              {item.label}
            </button>
          ))}
        </aside>
        <main className={styles.main}>
          {view === 'tenants' ? (
            <TenantsView />
          ) : view === 'installation' ? (
            <InstallationView />
          ) : (
            <LogView />
          )}
        </main>
      </div>
      <footer className={styles.statusbar}>{t('operator.status')}</footer>
    </div>
  );
}

/** Console of the operator: organisations, their limits and usage, the installation, the log. */
export function OperatorApp() {
  const fetcher = useCallback(() => api(operatorSessionSchema, '/api/operator/session'), []);
  const { data, reload } = useApi(fetcher);
  if (!data) return null;
  if (!data.authenticated) return <Login onSignedIn={reload} />;
  setCsrfToken(data.csrfToken);
  return <Console onSignedOut={reload} />;
}
