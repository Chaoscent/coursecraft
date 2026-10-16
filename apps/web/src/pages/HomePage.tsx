// SPDX-License-Identifier: Apache-2.0
import { useTranslation } from 'react-i18next';
import { DataTable } from '../components/DataTable.js';
import { Page } from '../components/Page.js';

/** Learner portal; assignments arrive with the LMS (Phase 5). */
export function HomePage() {
  const { t } = useTranslation();
  return (
    <Page title={t('home.title')}>
      <DataTable
        label={t('home.title')}
        columns={[
          { id: 'title', label: t('home.course'), render: () => null, isRowHeader: true },
          { id: 'due', label: t('home.due'), render: () => null },
          { id: 'progress', label: t('home.progress'), render: () => null },
        ]}
        rows={[]}
        empty={t('home.empty')}
      />
    </Page>
  );
}
