// SPDX-License-Identifier: Apache-2.0
import {
  okSchema,
  operatorCreatedSchema,
  operatorSessionSchema,
  operatorSetupTokenSchema,
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
import { Notice } from '../components/Notice.js';
import { Page, ToolbarSeparator } from '../components/Page.js';
import { AuthFrame } from '../layout/AuthFrame.js';
import { errorMessage } from '../lib/errors.js';
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

function TenantDialog({
  tenant,
  onClose,
  onSaved,
}: {
  tenant: OperatorTenant | null;
  onClose: () => void;
  onSaved: (token?: { token: string; expiresAt: string; url: string }) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(tenant?.name ?? '');
  const [publicOrigin, setPublicOrigin] = useState('https://');
  const [contentOrigin, setContentOrigin] = useState('https://');
  const [maxUsers, setMaxUsers] = useState(tenant?.maxUsers ? String(tenant.maxUsers) : '');
  const [maxStorage, setMaxStorage] = useState(tenant?.maxStorageMb ? String(tenant.maxStorageMb) : '');
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    try {
      if (tenant) {
        await api(okSchema, `/api/operator/tenants/${tenant.id}`, {
          method: 'PATCH',
          body: { name, maxUsers: limitOf(maxUsers), maxStorageMb: limitOf(maxStorage) },
        });
        onSaved();
      } else {
        const created = await api(operatorCreatedSchema, '/api/operator/tenants', {
          method: 'POST',
          body: {
            name,
            publicOrigin,
            contentOrigin,
            maxUsers: limitOf(maxUsers),
            maxStorageMb: limitOf(maxStorage),
          },
        });
        onSaved({
          token: created.token,
          expiresAt: created.expiresAt,
          url: `${publicOrigin.replace(/\/+$/, '')}/setup`,
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
      width="md"
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
        {tenant ? null : (
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
        )}
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
      </FormGrid>
    </Dialog>
  );
}

function TokenDialog({
  token,
  onClose,
}: {
  token: { token: string; expiresAt: string; url: string };
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  return (
    <Dialog
      title={t('operator.tokenTitle')}
      isOpen
      width="md"
      onClose={onClose}
      footer={
        <Button variant="primary" onPress={onClose}>
          {t('common.close')}
        </Button>
      }
    >
      <Notice tone="info">
        {t('operator.tokenHint', {
          url: token.url,
          until: new Date(token.expiresAt).toLocaleString(i18n.language),
        })}
      </Notice>
      <div className={styles.token}>{token.token}</div>
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

function Tenants({ onSignedOut }: { onSignedOut: () => void }) {
  const { t, i18n } = useTranslation();
  const [selected, setSelected] = useState<Selection>(new Set());
  const [dialog, setDialog] = useState<null | 'new' | 'edit' | 'delete'>(null);
  const [token, setToken] = useState<{ token: string; expiresAt: string; url: string } | null>(null);
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
      .then((r) => setToken({ ...r, url: `${current.publicOrigin ?? ''}/setup` }))
      .catch(fail);
  };
  const signOut = () => {
    void api(okSchema, '/api/operator/logout', { method: 'POST' }).finally(() => {
      setCsrfToken(null);
      onSignedOut();
    });
  };
  const limit = (used: string, max: string | null) => (max ? `${used} / ${max}` : used);

  return (
    <div className={styles.app}>
      <nav className={styles.menubar} aria-label={t('shell.mainMenu')}>
        <span className={styles.brand}>{t('operator.brand')}</span>
        <span className={styles.spacer} />
        <ToolButton icon="log-out" onPress={signOut}>
          {t('menu.logout')}
        </ToolButton>
      </nav>
      <main className={styles.main}>
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
                  render: (x) => limit(String(x.users), x.maxUsers ? String(x.maxUsers) : null),
                },
                {
                  id: 'storage',
                  label: t('operator.storage'),
                  numeric: true,
                  render: (x) =>
                    limit(
                      size(x.storageBytes, i18n.language),
                      x.maxStorageMb ? size(x.maxStorageMb * 1024 * 1024, i18n.language) : null,
                    ),
                },
              ]}
            />
          </div>
        </Page>
      </main>
      <footer className={styles.statusbar}>{t('operator.status')}</footer>
      {dialog === 'new' ? (
        <TenantDialog
          tenant={null}
          onClose={() => setDialog(null)}
          onSaved={(created) => {
            setDialog(null);
            if (created) setToken(created);
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
      {token ? <TokenDialog token={token} onClose={() => setToken(null)} /> : null}
    </div>
  );
}

/** Console of the operator: organisations, their limits and usage. */
export function OperatorApp() {
  const fetcher = useCallback(() => api(operatorSessionSchema, '/api/operator/session'), []);
  const { data, reload } = useApi(fetcher);
  if (!data) return null;
  if (!data.authenticated) return <Login onSignedIn={reload} />;
  setCsrfToken(data.csrfToken);
  return <Tenants onSignedOut={reload} />;
}
