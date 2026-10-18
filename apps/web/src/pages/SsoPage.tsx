// SPDX-License-Identifier: Apache-2.0
import {
  directorySyncResultSchema,
  idParamSchema,
  okSchema,
  ssoPolicySchema,
  SSO_KINDS,
  SSO_ROLES,
  ssoProvidersResponseSchema,
  type SsoProvider,
} from '@coursecraft/shared';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../api/client.js';
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

const DEFAULT_FILTER = '(&(objectClass=user)(sAMAccountName={username}))';

const groupRolesText = (p: SsoProvider | null): string => {
  const value = p?.config['groupRoles'];
  if (!Array.isArray(value)) return '';
  return value
    .map((m: { group?: string; role?: string }) => `${m.group ?? ''} => ${m.role ?? ''}`)
    .join('\n');
};

/** Lines of `group DN => role`; a line without a valid role is reported as an error. */
function parseGroupRoles(text: string): { group: string; role: (typeof SSO_ROLES)[number] }[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const at = line.lastIndexOf('=>');
      const group = line.slice(0, Math.max(at, 0)).trim();
      const role = SSO_ROLES.find((r) => r === line.slice(at + 2).trim());
      if (at < 0 || !group || !role) throw new Error(line);
      return { group, role };
    });
}

const listOf = (p: SsoProvider | null, key: string): string => {
  const value = p?.config[key];
  return Array.isArray(value) ? value.join('\n') : '';
};

const cfg = (p: SsoProvider | null, key: string, fallback = ''): string => {
  const value = p?.config[key];
  return typeof value === 'string' ? value : fallback;
};

function ProviderDialog({
  provider,
  directories,
  onClose,
  onSaved,
}: {
  provider: SsoProvider | null;
  directories: SsoProvider[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<(typeof SSO_KINDS)[number]>(provider?.kind ?? 'oidc');
  const [name, setName] = useState(provider?.name ?? '');
  const [entryPoint, setEntryPoint] = useState(cfg(provider, 'entryPoint'));
  const [idpIssuer, setIdpIssuer] = useState(cfg(provider, 'idpIssuer'));
  const [idpCert, setIdpCert] = useState(cfg(provider, 'idpCert'));
  const [spEntityId, setSpEntityId] = useState(cfg(provider, 'spEntityId', `${window.location.origin}/sp`));
  const [issuer, setIssuer] = useState(cfg(provider, 'issuer'));
  const [clientId, setClientId] = useState(cfg(provider, 'clientId'));
  const [secret, setSecret] = useState('');
  const [removeSecret, setRemoveSecret] = useState(false);
  const [scopes, setScopes] = useState(cfg(provider, 'scopes', 'openid email profile'));
  const [groupClaim, setGroupClaim] = useState(cfg(provider, 'groupClaim'));
  const [singleLogout, setSingleLogout] = useState(provider?.config['singleLogout'] === true);
  const [logoutUrl, setLogoutUrl] = useState(cfg(provider, 'logoutUrl'));
  const [domains, setDomains] = useState((provider?.allowedDomains ?? []).join(', '));
  const [autoCreate, setAutoCreate] = useState(provider?.autoCreate ?? false);
  const [role, setRole] = useState<(typeof SSO_ROLES)[number]>(provider?.defaultRole ?? 'learner');
  const [emailTrusted, setEmailTrusted] = useState(provider?.emailTrusted ?? false);
  const [ldapUrl, setLdapUrl] = useState(cfg(provider, 'url'));
  const [startTls, setStartTls] = useState(provider?.config['startTls'] === true);
  const [caCert, setCaCert] = useState(cfg(provider, 'caCert'));
  const [tlsServerName, setTlsServerName] = useState(cfg(provider, 'tlsServerName'));
  const [bindDn, setBindDn] = useState(cfg(provider, 'bindDn'));
  const [userBase, setUserBase] = useState(cfg(provider, 'userBase'));
  const [userFilter, setUserFilter] = useState(cfg(provider, 'userFilter', DEFAULT_FILTER));
  const [subjectAttribute, setSubjectAttribute] = useState(cfg(provider, 'subjectAttribute', 'objectGUID'));
  const [emailAttribute, setEmailAttribute] = useState(cfg(provider, 'emailAttribute', 'mail'));
  const [nameAttribute, setNameAttribute] = useState(cfg(provider, 'nameAttribute', 'displayName'));
  const [groupAttribute, setGroupAttribute] = useState(cfg(provider, 'groupAttribute', 'memberOf'));
  const [requiredGroup, setRequiredGroup] = useState(cfg(provider, 'requiredGroup'));
  const [groupRoles, setGroupRoles] = useState(groupRolesText(provider));
  const [syncEnabled, setSyncEnabled] = useState(provider?.config['syncEnabled'] === true);
  const [syncFilter, setSyncFilter] = useState(cfg(provider, 'syncFilter'));
  const [header, setHeader] = useState(cfg(provider, 'header', 'x-remote-user'));
  const [trustedProxies, setTrustedProxies] = useState(listOf(provider, 'trustedProxies'));
  const [secretHeader, setSecretHeader] = useState(cfg(provider, 'secretHeader', 'x-proxy-secret'));
  const [stripRealm, setStripRealm] = useState(provider?.config['stripRealm'] !== false);
  const [directoryId, setDirectoryId] = useState(cfg(provider, 'directoryProviderId', 'none'));
  const [enabled, setEnabled] = useState(provider?.enabled ?? true);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    try {
      const shared = {
        name,
        enabled,
        allowedDomains: domains
          .split(/[\s,;]+/)
          .map((d) => d.trim().toLowerCase())
          .filter(Boolean),
        autoCreate,
        defaultRole: role,
        emailTrusted,
      };
      const secretField = (name: string) =>
        removeSecret ? { [name]: null } : secret ? { [name]: secret } : {};
      const body =
        kind === 'saml'
          ? {
              kind,
              ...shared,
              entryPoint,
              idpIssuer,
              idpCert,
              spEntityId,
              groupClaim,
              groupRoles: parseGroupRoles(groupRoles),
              logoutUrl,
            }
          : kind === 'proxy'
            ? {
                kind,
                ...shared,
                header,
                trustedProxies: trustedProxies.split(/[\s,;]+/).filter(Boolean),
                // The header name only means something together with a secret.
                secretHeader: !removeSecret && (secret || provider?.secret.set) ? secretHeader : '',
                stripRealm,
                directoryProviderId: directoryId === 'none' ? null : directoryId,
                ...secretField('sharedSecret'),
              }
            : kind === 'ldap'
              ? {
                  kind,
                  ...shared,
                  url: ldapUrl,
                  startTls,
                  caCert,
                  tlsServerName,
                  bindDn,
                  userBase,
                  userFilter,
                  subjectAttribute,
                  emailAttribute,
                  nameAttribute,
                  groupAttribute,
                  requiredGroup,
                  syncEnabled,
                  syncFilter,
                  groupRoles: parseGroupRoles(groupRoles),
                  ...secretField('bindPassword'),
                }
              : {
                  kind,
                  ...shared,
                  issuer,
                  clientId,
                  scopes,
                  groupClaim,
                  groupRoles: parseGroupRoles(groupRoles),
                  singleLogout,
                  ...secretField('clientSecret'),
                };
      if (provider) await api(idParamSchema, `/api/sso/providers/${provider.id}`, { method: 'PUT', body });
      else await api(idParamSchema, '/api/sso/providers', { method: 'POST', body });
      onSaved();
    } catch (e) {
      setError(
        e instanceof Error && !(e instanceof ApiError)
          ? t('sso.groupRolesInvalid', { line: e.message })
          : errorMessage(e),
      );
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
      {kind === 'ldap' ? (
        <Notice tone="info">{t('sso.ldapNote')}</Notice>
      ) : kind === 'proxy' ? (
        <Notice tone="info">
          {t('sso.proxyNote')}
          {provider ? ` ${t('sso.proxyUrl', { url: provider.callbackUrl })}` : ''}
        </Notice>
      ) : provider ? (
        <Notice tone="info">
          {t(kind === 'saml' ? 'sso.acsHint' : 'sso.callbackHint', { url: provider.callbackUrl })}
          {provider.metadataUrl ? ` ${t('sso.metadataHint', { url: provider.metadataUrl })}` : ''}
        </Notice>
      ) : (
        <Notice tone="info">{t('sso.callbackHintNew')}</Notice>
      )}
      <FormGrid wide>
        <SelectField
          label={t('sso.kind')}
          value={kind}
          onChange={setKind}
          isDisabled={!!provider}
          options={SSO_KINDS.map((k) => ({ id: k, label: t(`sso.kinds.${k}`) }))}
        />
        <TextField
          label={t('sso.name')}
          value={name}
          onChange={setName}
          isRequired
          autoFocus
          description={t('sso.nameHint')}
        />
        {kind === 'oidc' ? (
          <>
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
              label={t('sso.groupClaim')}
              value={groupClaim}
              onChange={setGroupClaim}
              description={t('sso.groupClaimHint')}
            />
            <TextField
              label={t('sso.groupRoles')}
              multiline
              value={groupRoles}
              onChange={setGroupRoles}
              description={t('sso.groupRolesHint')}
            />
            <FormRow label="">
              <Checkbox isSelected={singleLogout} onChange={setSingleLogout}>
                {t('sso.singleLogout')}
              </Checkbox>
            </FormRow>
          </>
        ) : kind === 'proxy' ? (
          <>
            <TextField
              label={t('sso.proxyHeader')}
              value={header}
              onChange={setHeader}
              isRequired
              description={t('sso.proxyHeaderHint')}
            />
            <TextField
              label={t('sso.trustedProxies')}
              multiline
              value={trustedProxies}
              onChange={setTrustedProxies}
              isRequired
              description={t('sso.trustedProxiesHint')}
            />
            <TextField
              label={t('sso.secretHeader')}
              value={secretHeader}
              onChange={setSecretHeader}
              description={t('sso.secretHeaderHint')}
            />
            <TextField
              label={t('sso.sharedSecret')}
              type="password"
              autoComplete="off"
              value={secret}
              onChange={setSecret}
              isDisabled={removeSecret}
              description={
                provider?.secret.set
                  ? t('sso.secretStored', { last4: provider.secret.last4 ?? '' })
                  : t('sso.sharedSecretHint')
              }
            />
            {provider?.secret.set ? (
              <FormRow label="">
                <Checkbox isSelected={removeSecret} onChange={setRemoveSecret}>
                  {t('sso.removeSecret')}
                </Checkbox>
              </FormRow>
            ) : null}
            <FormRow label="">
              <Checkbox isSelected={stripRealm} onChange={setStripRealm}>
                {t('sso.stripRealm')}
              </Checkbox>
            </FormRow>
            <SelectField
              label={t('sso.directory')}
              value={directoryId}
              onChange={setDirectoryId}
              options={[
                { id: 'none', label: t('sso.noDirectory') },
                ...directories.map((d) => ({ id: d.id, label: d.name })),
              ]}
            />
          </>
        ) : kind === 'ldap' ? (
          <>
            <TextField
              label={t('sso.ldapUrl')}
              value={ldapUrl}
              onChange={setLdapUrl}
              isRequired
              description={t('sso.ldapUrlHint')}
            />
            <FormRow label="">
              <Checkbox isSelected={startTls} onChange={setStartTls}>
                {t('sso.startTls')}
              </Checkbox>
            </FormRow>
            <TextField
              label={t('sso.caCert')}
              multiline
              value={caCert}
              onChange={setCaCert}
              description={t('sso.caCertHint')}
            />
            <TextField
              label={t('sso.tlsServerName')}
              value={tlsServerName}
              onChange={setTlsServerName}
              description={t('sso.tlsServerNameHint')}
            />
            <TextField
              label={t('sso.bindDn')}
              value={bindDn}
              onChange={setBindDn}
              description={t('sso.bindDnHint')}
            />
            <TextField
              label={t('sso.bindPassword')}
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
            <TextField
              label={t('sso.userBase')}
              value={userBase}
              onChange={setUserBase}
              isRequired
              description={t('sso.userBaseHint')}
            />
            <TextField
              label={t('sso.userFilter')}
              value={userFilter}
              onChange={setUserFilter}
              isRequired
              description={t('sso.userFilterHint')}
            />
            <TextField
              label={t('sso.subjectAttribute')}
              value={subjectAttribute}
              onChange={setSubjectAttribute}
              isRequired
              description={t('sso.subjectAttributeHint')}
            />
            <TextField
              label={t('sso.emailAttribute')}
              value={emailAttribute}
              onChange={setEmailAttribute}
              isRequired
            />
            <TextField
              label={t('sso.nameAttribute')}
              value={nameAttribute}
              onChange={setNameAttribute}
              isRequired
            />
            <TextField
              label={t('sso.groupAttribute')}
              value={groupAttribute}
              onChange={setGroupAttribute}
              isRequired
            />
            <TextField
              label={t('sso.requiredGroup')}
              value={requiredGroup}
              onChange={setRequiredGroup}
              description={t('sso.requiredGroupHint')}
            />
            <FormRow label="">
              <Checkbox isSelected={syncEnabled} onChange={setSyncEnabled}>
                {t('sso.syncEnabled')}
              </Checkbox>
            </FormRow>
            <TextField
              label={t('sso.syncFilter')}
              value={syncFilter}
              onChange={setSyncFilter}
              isDisabled={!syncEnabled}
              description={t('sso.syncFilterHint')}
            />
            <TextField
              label={t('sso.groupRoles')}
              multiline
              value={groupRoles}
              onChange={setGroupRoles}
              description={t('sso.groupRolesHint')}
            />
          </>
        ) : (
          <>
            <TextField
              label={t('sso.entryPoint')}
              value={entryPoint}
              onChange={setEntryPoint}
              isRequired
              description={t('sso.entryPointHint')}
            />
            <TextField
              label={t('sso.idpIssuer')}
              value={idpIssuer}
              onChange={setIdpIssuer}
              isRequired
              description={t('sso.idpIssuerHint')}
            />
            <TextField
              label={t('sso.idpCert')}
              multiline
              value={idpCert}
              onChange={setIdpCert}
              isRequired
              description={t('sso.idpCertHint')}
            />
            <TextField
              label={t('sso.spEntityId')}
              value={spEntityId}
              onChange={setSpEntityId}
              isRequired
              description={t('sso.spEntityIdHint')}
            />
            <TextField
              label={t('sso.groupAttributeSaml')}
              value={groupClaim}
              onChange={setGroupClaim}
              description={t('sso.groupAttributeSamlHint')}
            />
            <TextField
              label={t('sso.groupRoles')}
              multiline
              value={groupRoles}
              onChange={setGroupRoles}
              description={t('sso.groupRolesHint')}
            />
            <TextField
              label={t('sso.logoutUrl')}
              value={logoutUrl}
              onChange={setLogoutUrl}
              description={t('sso.logoutUrlHint')}
            />
          </>
        )}
        <TextField
          label={t('sso.domains')}
          value={domains}
          onChange={setDomains}
          description={t('sso.domainsHint')}
        />
        {kind === 'oidc' || kind === 'ldap' ? (
          <FormRow label="">
            <Checkbox isSelected={emailTrusted} onChange={setEmailTrusted}>
              {t('sso.emailTrusted')}
            </Checkbox>
          </FormRow>
        ) : null}
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
  const [message, setMessage] = useState<string | null>(null);
  const policyFetcher = useCallback(() => api(ssoPolicySchema, '/api/sso/policy'), []);
  const { data: policy, reload: reloadPolicy } = useApi(policyFetcher);
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
  const setAdminOnly = (localLoginAdminOnly: boolean) =>
    void api(okSchema, '/api/sso/policy', { method: 'PUT', body: { localLoginAdminOnly } })
      .then(reloadPolicy)
      .catch((e: unknown) => setError(errorMessage(e)));
  const syncNow = () => {
    if (!current) return;
    setError(null);
    setMessage(null);
    void api(directorySyncResultSchema, `/api/sso/providers/${current.id}/sync`, { method: 'POST' })
      .then((r) =>
        setMessage(
          r.skipped ? t(`sso.syncSkipped.${r.skipped}`) : t('sso.syncDone', { count: r.deactivated }),
        ),
      )
      .catch((e: unknown) => setError(errorMessage(e)));
  };
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
          <ToolbarSeparator />
          <ToolButton
            icon="refresh-cw"
            isDisabled={!current || current.kind !== 'ldap' || !current.enabled}
            onPress={syncNow}
          >
            {t('sso.syncNow')}
          </ToolButton>
        </>
      }
    >
      <div className={styles.stack}>
        <Notice tone="info">{t('sso.privacyNote')}</Notice>
        {message ? <Notice tone="success">{message}</Notice> : null}
        <Checkbox isSelected={policy?.localLoginAdminOnly ?? false} onChange={setAdminOnly}>
          {t('sso.adminOnly')}
        </Checkbox>
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
            { id: 'kind', label: t('sso.kind'), render: (p) => t(`sso.kinds.${p.kind}`) },
            {
              id: 'issuer',
              label: t('sso.issuer'),
              render: (p) => cfg(p, 'issuer') || cfg(p, 'entryPoint') || cfg(p, 'url') || cfg(p, 'header'),
            },
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
        <ProviderDialog
          provider={null}
          directories={providers.filter((p) => p.kind === 'ldap')}
          onClose={() => setDialog(null)}
          onSaved={done}
        />
      ) : null}
      {dialog === 'edit' && current ? (
        <ProviderDialog
          provider={current}
          directories={providers.filter((p) => p.kind === 'ldap')}
          onClose={() => setDialog(null)}
          onSaved={done}
        />
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
