// SPDX-License-Identifier: Apache-2.0
import {
  AI_PROVIDER_KINDS,
  aiProvidersResponseSchema,
  idParamSchema,
  okSchema,
  type AiProvider,
  type AiProviderKind,
} from '@lernwerk/shared';
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

const KEEP = '';

function ProviderDialog({
  provider,
  onClose,
  onSaved,
}: {
  provider: AiProvider | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(provider?.name ?? '');
  const [kind, setKind] = useState<AiProviderKind>(provider?.kind ?? 'openai');
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? '');
  const [model, setModel] = useState(provider?.model ?? '');
  const [enabled, setEnabled] = useState(provider?.enabled ?? true);
  const [allowUserKeys, setAllowUserKeys] = useState(provider?.allowUserKeys ?? false);
  const [quota, setQuota] = useState(provider?.dailyQuota ? String(provider.dailyQuota) : '');
  const [key, setKey] = useState(KEEP);
  const [removeKey, setRemoveKey] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    const dailyQuota = quota.trim() ? Math.round(Number(quota)) : null;
    try {
      const body = {
        name,
        kind,
        baseUrl,
        model,
        enabled,
        allowUserKeys,
        dailyQuota,
        ...(removeKey ? { key: null } : key ? { key } : {}),
      };
      if (provider) await api(idParamSchema, `/api/ai/providers/${provider.id}`, { method: 'PATCH', body });
      else await api(idParamSchema, '/api/ai/providers', { method: 'POST', body });
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <Dialog
      title={provider ? t('ai.editProvider') : t('ai.newProvider')}
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
      <FormGrid wide>
        <TextField label={t('ai.name')} value={name} onChange={setName} isRequired autoFocus />
        <SelectField
          label={t('ai.kind')}
          value={kind}
          onChange={setKind}
          options={AI_PROVIDER_KINDS.map((k) => ({ id: k, label: t(`ai.kinds.${k}`) }))}
        />
        <TextField
          label={t('ai.baseUrl')}
          value={baseUrl}
          onChange={setBaseUrl}
          isRequired
          description={t(kind === 'anthropic' ? 'ai.baseUrlAnthropic' : 'ai.baseUrlOpenai')}
        />
        <TextField label={t('ai.model')} value={model} onChange={setModel} isRequired />
        <TextField
          label={t('ai.key')}
          type="password"
          autoComplete="off"
          value={key}
          onChange={setKey}
          isDisabled={removeKey}
          description={
            provider?.key.set ? t('ai.keyStored', { last4: provider.key.last4 ?? '' }) : t('ai.keyHint')
          }
        />
        {provider?.key.set ? (
          <FormRow label="">
            <Checkbox isSelected={removeKey} onChange={setRemoveKey}>
              {t('ai.removeKey')}
            </Checkbox>
          </FormRow>
        ) : null}
        <TextField
          label={t('ai.dailyQuota')}
          value={quota}
          onChange={setQuota}
          description={t('ai.dailyQuotaHint')}
        />
        <FormRow label="">
          <Checkbox isSelected={allowUserKeys} onChange={setAllowUserKeys}>
            {t('ai.allowUserKeys')}
          </Checkbox>
        </FormRow>
        <FormRow label="">
          <Checkbox isSelected={enabled} onChange={setEnabled}>
            {t('ai.enabled')}
          </Checkbox>
        </FormRow>
      </FormGrid>
    </Dialog>
  );
}

/** Administration of AI providers. Nothing is sent from here; authors confirm each request. */
export function AiPage() {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<Selection>(new Set());
  const [dialog, setDialog] = useState<null | 'new' | 'edit' | 'delete'>(null);
  const [actionError, setError] = useState<string | null>(null);
  const fetcher = useCallback(() => api(aiProvidersResponseSchema, '/api/ai/providers'), []);
  const { data, error: loadError, reload } = useApi(fetcher);
  const providers = useMemo(() => data?.providers ?? [], [data]);
  const current = useMemo(() => {
    if (selected === 'all' || selected.size !== 1) return null;
    const [id] = [...selected];
    return providers.find((p) => p.id === id) ?? null;
  }, [selected, providers]);
  const error = actionError ?? loadError;
  const allowed = data?.allowedByOperator ?? false;
  const done = () => {
    setDialog(null);
    reload();
  };

  return (
    <Page
      title={t('ai.title')}
      meta={t('ai.count', { count: providers.length })}
      toolbar={
        <>
          <ToolButton icon="plus" isDisabled={!allowed} onPress={() => setDialog('new')}>
            {t('ai.newProvider')}
          </ToolButton>
          <ToolbarSeparator />
          <ToolButton icon="pencil" isDisabled={!allowed || !current} onPress={() => setDialog('edit')}>
            {t('ai.editProvider')}
          </ToolButton>
          <ToolButton icon="trash-2" isDisabled={!current} onPress={() => setDialog('delete')}>
            {t('ai.deleteProvider')}
          </ToolButton>
        </>
      }
    >
      <div className={styles.stack}>
        {data && !allowed ? <Notice tone="info">{t('ai.offByOperator')}</Notice> : null}
        {allowed ? <Notice tone="info">{t('ai.privacyNote')}</Notice> : null}
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <DataTable
          label={t('ai.providers')}
          rows={providers}
          selectionMode="single"
          selected={selected}
          onSelectionChange={setSelected}
          empty={t('ai.empty')}
          columns={[
            { id: 'name', label: t('ai.name'), isRowHeader: true, render: (p) => p.name },
            { id: 'kind', label: t('ai.kind'), render: (p) => t(`ai.kinds.${p.kind}`) },
            { id: 'url', label: t('ai.baseUrl'), render: (p) => p.baseUrl },
            { id: 'model', label: t('ai.model'), render: (p) => p.model },
            {
              id: 'key',
              label: t('ai.key'),
              render: (p) => (p.key.set ? `•••• ${p.key.last4 ?? ''}` : '–'),
            },
            {
              id: 'quota',
              label: t('ai.dailyQuota'),
              numeric: true,
              render: (p) => (p.dailyQuota === null ? '–' : p.dailyQuota),
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
          title={t('ai.deleteProvider')}
          text={t('ai.deleteConfirm', { name: current.name })}
          action={t('ai.deleteProvider')}
          onClose={() => setDialog(null)}
          onConfirm={() =>
            void api(okSchema, `/api/ai/providers/${current.id}`, { method: 'DELETE' })
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
