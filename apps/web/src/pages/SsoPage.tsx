// SPDX-License-Identifier: Apache-2.0
import {
  idParamSchema,
  okSchema,
  SSO_ROLES,
  ssoProvidersResponseSchema,
  type SsoProvider,
} from '@coursecraft/shared';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client.js';
import { Badge } from '../components/Badge.js';
import { Button, ToolButton } from '../components/Button.js';
import { DataTable, type Selection } from '../components/DataTable.js';
import { Dialog } from '../components/Dialog.js';
import { Checkbox, FormGrid, FormRow, SelectField, TextField } from '../components/Field.js';
import { Notice } from '../components/Notice.js';
import { Page, ToolbarSeparator } from '../components/Page.js';
import { errorMessage } from '../lib/errors.js';
import { useApi } from '../lib/useApi.js';
import { ConfirmDialog } from './UsersPage.js';
import styles from './AdminPages.module.css';

const cfg = (p: SsoProvider | null, key: string, fallback = ''): string => {
  const value = p?.config[key];
  return typeof value === 'string' ? value : fallback;
};

function ProviderDialog({
  provider,
  onClose,
  onSaved,
}: {
  provider: SsoProvider | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(provider?.name ?? '');
  const [issuer, setIssuer] = useState(cfg(provider, 'issuer'));
  const [clientId, setClientId] = useState(cfg(provider, 'clientId'));
  const [secret, setSecret] = useState('');
  const [removeSecret, setRemoveSecret] = useState(false);
  const [scopes, setScopes] = useState(cfg(provider, 'scopes', 'openid email profile'));
  const [domains, setDomains] = useState((provider?.allowedDomains ?? []).join(', '));
  const [autoCreate, setAutoCreate] = useState(provider?.autoCreate ?? false);
  const [role, setRole] = useState<(typeof SSO_ROLES)[number]>(provider?.defaultRole ?? 'learner');
  const [emailTrusted, setEmailTrusted] = useState(provider?.emailTrusted ?? false);
  const [enabled, setEnabled] = useState(provider?.enabled ?? true);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    try {
      const body = {
        kind: 'oidc',
        name,
        enabled,
        issuer,
        clientId,
        scopes,
        allowedDomains: domains
          .split(/[\s,;]+/)
          .map((d) => d.trim().toLowerCase())
          .filter(Boolean),
        autoCreate,
        defaultRole: role,
        emailTrusted,
        ...(removeSecret ? { clientSecret: null } : secret ? { clientSecret: secret } : {}),
      };
      if (provider) await api(idParamSchema, `/api/sso/providers/${provider.id}`, { method: 'PUT', body });
      else await api(idParamSchema, '/api/sso/providers', { method: 'POST', body });
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <Dialog
      title={provider ? t('sso.edit') : t('sso.new')}
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
      {provider ? (
        <Notice tone="info">{t('sso.callbackHint', { url: provider.callbackUrl })}</Notice>
      ) : (
        <Notice tone="info">{t('sso.callbackHintNew')}</Notice>
      )}
      <FormGrid wide>
        <TextField
          label={t('sso.name')}
          value={name}
          onChange={setName}
          isRequired
          autoFocus
          description={t('sso.nameHint')}
        />
        <TextField
          label={t('sso.issuer')}
          value={issuer}
          onChange={setIssuer}
          isRequired
          description={t('sso.issuerHint')}
        />
        <TextField label={t('sso.clientId')} value={clientId} onChange={setClientId} isRequired />
        <TextField
          label={t('sso.clientSecret')}
          type="password"
          autoComplete="off"
          value={secret}
          onChange={setSecret}
          isDisabled={removeSecret}
          description={
            provider?.secret.set
              ? t('sso.secretStored', { last4: provider.secret.last4 ?? '' })
              : t('sso.secretHint')
          }
        />
        {provider?.secret.set ? (
          <FormRow label="">
            <Checkbox isSelected={removeSecret} onChange={setRemoveSecret}>
              {t('sso.removeSecret')}
            </Checkbox>
          </FormRow>
        ) : null}
        <TextField label={t('sso.scopes')} value={scopes} onChange={setScopes} />
        <TextField
          label={t('sso.domains')}
          value={domains}
          onChange={setDomains}
          description={t('sso.domainsHint')}
        />
        <FormRow label="">
          <Checkbox isSelected={emailTrusted} onChange={setEmailTrusted}>
            {t('sso.emailTrusted')}
          </Checkbox>
        </FormRow>
        <FormRow label="">
          <Checkbox isSelected={autoCreate} onChange={setAutoCreate}>
            {t('sso.autoCreate')}
          </Checkbox>
        </FormRow>
        <SelectField
          label={t('sso.defaultRole')}
          value={role}
          onChange={setRole}
          isDisabled={!autoCreate}
          options={SSO_ROLES.map((r) => ({ id: r, label: t(`roles.${r}`) }))}
        />
        <FormRow label="">
          <Checkbox isSelected={enabled} onChange={setEnabled}>
            {t('ai.enabled')}
          </Checkbox>
        </FormRow>
      </FormGrid>
    </Dialog>
  );
}

/** Single sign-on providers (OpenID Connect). */
export function SsoPage() {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<Selection>(new Set());
  const [dialog, setDialog] = useState<null | 'new' | 'edit' | 'delete'>(null);
  const [actionError, setError] = useState<string | null>(null);
  const fetcher = useCallback(
    () => api(ssoProvidersResponseSchema, '/api/sso/providers').then((r) => r.items),
    [],
  );
  const { data, error: loadError, reload } = useApi(fetcher);
  const providers = useMemo(() => data ?? [], [data]);
  const current = useMemo(() => {
    if (selected === 'all' || selected.size !== 1) return null;
    const [id] = [...selected];
    return providers.find((p) => p.id === id) ?? null;
  }, [selected, providers]);
  const done = () => {
    setDialog(null);
    reload();
  };

  return (
    <Page
      title={t('sso.title')}
      meta={t('sso.count', { count: providers.length })}
      toolbar={
        <>
          <ToolButton icon="key-round" onPress={() => setDialog('new')}>
            {t('sso.new')}
          </ToolButton>
          <ToolbarSeparator />
          <ToolButton icon="pencil" isDisabled={!current} onPress={() => setDialog('edit')}>
            {t('sso.edit')}
          </ToolButton>
          <ToolButton icon="trash-2" isDisabled={!current} onPress={() => setDialog('delete')}>
            {t('sso.delete')}
          </ToolButton>
        </>
      }
    >
      <div className={styles.stack}>
        <Notice tone="info">{t('sso.privacyNote')}</Notice>
        {(actionError ?? loadError) ? <Notice tone="danger">{actionError ?? loadError}</Notice> : null}
        <DataTable
          label={t('sso.title')}
          rows={providers}
          selectionMode="single"
          selected={selected}
          onSelectionChange={setSelected}
          empty={t('sso.empty')}
          columns={[
            { id: 'name', label: t('sso.name'), isRowHeader: true, render: (p) => p.name },
            { id: 'issuer', label: t('sso.issuer'), render: (p) => cfg(p, 'issuer') },
            {
              id: 'create',
              label: t('sso.autoCreate'),
              render: (p) => (p.autoCreate ? t(`roles.${p.defaultRole}`) : '–'),
            },
            {
              id: 'status',
              label: t('ai.status'),
              render: (p) => (
                <Badge tone={p.enabled ? 'success' : 'neutral'}>{p.enabled ? t('ai.on') : t('ai.off')}</Badge>
              ),
            },
          ]}
        />
      </div>
      {dialog === 'new' ? (
        <ProviderDialog provider={null} onClose={() => setDialog(null)} onSaved={done} />
      ) : null}
      {dialog === 'edit' && current ? (
        <ProviderDialog provider={current} onClose={() => setDialog(null)} onSaved={done} />
      ) : null}
      {dialog === 'delete' && current ? (
        <ConfirmDialog
          title={t('sso.delete')}
          text={t('sso.deleteConfirm', { name: current.name })}
          action={t('sso.delete')}
          onClose={() => setDialog(null)}
          onConfirm={() =>
            void api(okSchema, `/api/sso/providers/${current.id}`, { method: 'DELETE' })
              .then(() => {
                setSelected(new Set());
                done();
              })
              .catch((e: unknown) => setError(errorMessage(e)))
          }
        />
      ) : null}
    </Page>
  );
}
