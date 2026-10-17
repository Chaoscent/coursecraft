// SPDX-License-Identifier: Apache-2.0
import {
  certificateSchema,
  myItemsResponseSchema,
  type LearningStatus,
  type MyItem,
} from '@coursecraft/shared';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { api, download } from '../api/client.js';
import { Badge } from '../components/Badge.js';
import { Button } from '../components/Button.js';
import { DataTable } from '../components/DataTable.js';
import { Notice } from '../components/Notice.js';
import { Page } from '../components/Page.js';
import { errorMessage } from '../lib/errors.js';
import { formatDateTime } from '../lib/format.js';
import { useApi } from '../lib/useApi.js';
import styles from './AdminPages.module.css';

const EMPTY: MyItem[] = [];

export const STATUS_TONE: Record<LearningStatus, 'neutral' | 'success' | 'warning' | 'danger'> = {
  not_started: 'neutral',
  in_progress: 'warning',
  completed: 'success',
  passed: 'success',
  failed: 'danger',
};

/** Learner portal: assigned courses with status, due date and start/continue. */
export function HomePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const fetcher = useCallback(() => api(myItemsResponseSchema, '/api/learn/items').then((r) => r.items), []);
  const { data = EMPTY, error } = useApi(fetcher);
  const [certError, setCertError] = useState<string | null>(null);
  const certificate = async (itemId: string) => {
    setCertError(null);
    try {
      const cert = await api(certificateSchema, `/api/learn/items/${itemId}/certificate`, { method: 'POST' });
      await download(`/api/certificates/${cert.id}/pdf`, `${cert.serial}.pdf`);
    } catch (e) {
      setCertError(errorMessage(e));
    }
  };

  return (
    <Page title={t('home.title')} meta={t('home.count', { count: data.length })}>
      <div className={styles.stack}>
        {(error ?? certError) ? <Notice tone="danger">{error ?? certError}</Notice> : <span />}
        <DataTable
          label={t('home.title')}
          rows={data}
          onRowAction={(id) => void navigate(`/learn/${id}`)}
          empty={t('home.empty')}
          columns={[
            {
              id: 'title',
              label: t('home.course'),
              isRowHeader: true,
              render: (i) => (
                <>
                  {i.title}
                  {i.path ? (
                    <span className={styles.muted}>
                      {' '}
                      · {t('home.pathStep', { path: i.path.title, step: i.path.step, steps: i.path.steps })}
                    </span>
                  ) : null}
                </>
              ),
            },
            {
              id: 'status',
              label: t('home.status'),
              render: (i) => <Badge tone={STATUS_TONE[i.status]}>{t(`learning.status.${i.status}`)}</Badge>,
            },
            {
              id: 'score',
              label: t('home.score'),
              numeric: true,
              render: (i) => (i.scoreScaled === null ? '–' : `${Math.round(i.scoreScaled * 100)} %`),
            },
            {
              id: 'due',
              label: t('home.due'),
              numeric: true,
              render: (i) =>
                i.dueAt ? (
                  <span className={i.overdue ? styles.overdue : ''}>{formatDateTime(i.dueAt)}</span>
                ) : (
                  '–'
                ),
            },
            {
              id: 'action',
              label: t('home.action'),
              render: (i) => (
                <span className={styles.rowActions}>
                  <Button isDisabled={i.locked} onPress={() => void navigate(`/learn/${i.id}`)}>
                    {i.status === 'not_started'
                      ? t('home.start')
                      : i.status === 'in_progress'
                        ? t('home.continue')
                        : t('home.review')}
                  </Button>
                  {i.locked ? <span className={styles.muted}>{t('home.locked')}</span> : null}
                  {i.status === 'passed' || i.status === 'completed' ? (
                    <Button icon="award" onPress={() => void certificate(i.id)}>
                      {t('home.certificate')}
                    </Button>
                  ) : null}
                </span>
              ),
            },
          ]}
        />
      </div>
    </Page>
  );
}
