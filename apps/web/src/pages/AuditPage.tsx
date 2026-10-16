// SPDX-License-Identifier: Apache-2.0
import { listAuditResponseSchema, type AuditEntry } from '@lernwerk/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client.js';
import { ToolButton } from '../components/Button.js';
import { DataTable } from '../components/DataTable.js';
import { TextField } from '../components/Field.js';
import { Notice } from '../components/Notice.js';
import { Page } from '../components/Page.js';
import { errorMessage } from '../lib/errors.js';
import { formatDateTime, formatNumber } from '../lib/format.js';
import styles from './AdminPages.module.css';

const PAGE_SIZE = 100;

export function AuditPage() {
  const { t, i18n } = useTranslation();
  const [items, setItems] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api(listAuditResponseSchema, '/api/audit', {
      query: { action: action.trim() || undefined, page, pageSize: PAGE_SIZE },
    })
      .then((r) => {
        setItems(r.items);
        setTotal(r.total);
        setError(null);
      })
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [action, page]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const label = (a: string) => (i18n.exists(`audit.actions.${a}`) ? t(`audit.actions.${a}`) : a);

  return (
    <Page
      title={t('audit.title')}
      meta={t('audit.count', { formatted: formatNumber(total) })}
      toolbar={
        <div className={styles.filter}>
          <TextField
            label={t('audit.action')}
            type="search"
            value={action}
            onChange={(v) => {
              setAction(v);
              setPage(1);
            }}
          />
        </div>
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
        {error ? <Notice tone="danger">{error}</Notice> : <span />}
        <DataTable
          label={t('audit.title')}
          rows={items}
          empty={t('audit.empty')}
          columns={[
            { id: 'at', label: t('audit.at'), numeric: true, render: (e) => formatDateTime(e.at) },
            { id: 'actor', label: t('audit.actor'), render: (e) => e.actorName ?? '–' },
            { id: 'action', label: t('audit.action'), isRowHeader: true, render: (e) => label(e.action) },
            {
              id: 'target',
              label: t('audit.target'),
              render: (e) => (e.targetType ? `${e.targetType} ${e.targetId ?? ''}` : ''),
            },
            {
              id: 'meta',
              label: t('audit.details'),
              render: (e) => (
                <span className={styles.mono}>
                  {Object.keys(e.meta).length ? JSON.stringify(e.meta) : ''}
                </span>
              ),
            },
          ]}
        />
      </div>
    </Page>
  );
}
