// SPDX-License-Identifier: Apache-2.0
import { listCoursesResponseSchema, okSchema, type CourseSummary } from '@coursecraft/shared';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { z } from 'zod';
import { api } from '../api/client.js';
import { useSession } from '../api/session.js';
import { Badge } from '../components/Badge.js';
import { Button, ToolButton } from '../components/Button.js';
import { DataTable, type Selection, type SortDescriptor } from '../components/DataTable.js';
import { Dialog } from '../components/Dialog.js';
import { FormGrid, SelectField, TextField } from '../components/Field.js';
import { Notice } from '../components/Notice.js';
import { Page, ToolbarSeparator, ToolbarSpacer } from '../components/Page.js';
import { errorMessage } from '../lib/errors.js';
import { formatDateTime } from '../lib/format.js';
import { useApi } from '../lib/useApi.js';
import { chooseFile } from '../editor/upload.js';
import { ImportDialog, startImport } from './ImportDialog.js';
import { ConfirmDialog } from './UsersPage.js';
import styles from './AdminPages.module.css';

const EMPTY: CourseSummary[] = [];
const PPTX_TYPES =
  '.pptx,.ppsx,.potx,application/vnd.openxmlformats-officedocument.presentationml.presentation';

function NewCourseDialog({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [language, setLanguage] = useState(i18n.language === 'en' ? 'en' : 'de');
  const [error, setError] = useState<string | null>(null);
  const create = async () => {
    try {
      const { id } = await api(z.object({ id: z.uuid() }), '/api/courses', {
        method: 'POST',
        body: { title, language },
      });
      void navigate(`/author/courses/${id}`);
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <Dialog
      title={t('courses.new')}
      isOpen
      onClose={onClose}
      onSubmit={() => void create()}
      footer={
        <>
          <Button onPress={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" isDisabled={!title.trim()}>
            {t('courses.create')}
          </Button>
        </>
      }
    >
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <FormGrid>
        <TextField label={t('courses.title')} value={title} onChange={setTitle} isRequired autoFocus />
        <SelectField
          label={t('courses.language')}
          value={language}
          onChange={setLanguage}
          options={[
            { id: 'de', label: 'Deutsch' },
            { id: 'en', label: 'English' },
          ]}
        />
      </FormGrid>
    </Dialog>
  );
}

export function CoursesPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { session } = useSession();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'draft' | 'archived'>('draft');
  const [sort, setSort] = useState<SortDescriptor>({ column: 'updated', direction: 'descending' });
  const [selected, setSelected] = useState<Selection>(new Set());
  const [dialog, setDialog] = useState<null | 'new' | 'archive'>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [published, setPublished] = useState<string | null>(null);
  const [importing, setImporting] = useState<{
    name: string;
    id: string | null;
    error: string | null;
  } | null>(null);

  const importPresentation = async () => {
    const file = await chooseFile(PPTX_TYPES);
    if (!file) return;
    setImporting({ name: file.name, id: null, error: null });
    try {
      const id = await startImport(file, i18n.language === 'en' ? 'en' : 'de');
      setImporting({ name: file.name, id, error: null });
    } catch (e) {
      setImporting({ name: file.name, id: null, error: errorMessage(e) });
    }
  };

  const fetcher = useCallback(
    () =>
      api(listCoursesResponseSchema, '/api/courses', {
        query: {
          q,
          status,
          sort: sort.column === 'title' ? 'title' : 'updated',
          dir: sort.direction === 'ascending' ? 'asc' : 'desc',
        },
      }).then((r) => r.items),
    [q, status, sort],
  );
  const { data = EMPTY, error, reload } = useApi(fetcher);
  const current = useMemo(() => {
    if (selected === 'all' || selected.size !== 1) return null;
    const [id] = [...selected];
    return data.find((c) => c.id === id) ?? null;
  }, [selected, data]);
  const canManage =
    current && (current.ownerId === session?.user.id || session?.user.roles.includes('admin'));

  return (
    <Page
      title={t('courses.title_plural')}
      meta={t('courses.count', { count: data.length })}
      toolbar={
        <>
          <ToolButton icon="plus" onPress={() => setDialog('new')}>
            {t('courses.new')}
          </ToolButton>
          <ToolButton icon="file-up" onPress={() => void importPresentation()}>
            {t('import.action')}
          </ToolButton>
          <ToolbarSeparator />
          <ToolButton
            icon="pencil"
            isDisabled={!current}
            onPress={() => current && void navigate(`/author/courses/${current.id}`)}
          >
            {t('courses.open')}
          </ToolButton>
          <ToolButton
            icon="monitor-up"
            isDisabled={!current || status === 'archived'}
            onPress={() =>
              current &&
              void api(z.object({ id: z.uuid(), version: z.number() }), '/api/library/publish', {
                method: 'POST',
                body: { courseId: current.id },
              })
                .then((r) => {
                  setActionError(null);
                  setPublished(t('courses.published', { title: current.title, version: r.version }));
                })
                .catch((e: unknown) => setActionError(errorMessage(e)))
            }
          >
            {t('courses.publish')}
          </ToolButton>
          <ToolButton
            icon="archive"
            isDisabled={!canManage || status === 'archived'}
            onPress={() => setDialog('archive')}
          >
            {t('courses.archive')}
          </ToolButton>
          <ToolbarSpacer />
          <div className={styles.filter}>
            <TextField label={t('common.search')} type="search" value={q} onChange={setQ} />
          </div>
          <div className={styles.filter}>
            <SelectField
              label={t('courses.status')}
              value={status}
              onChange={setStatus}
              options={[
                { id: 'draft', label: t('courses.drafts') },
                { id: 'archived', label: t('courses.archived') },
              ]}
            />
          </div>
        </>
      }
    >
      <div className={styles.stack}>
        {error || actionError ? (
          <Notice tone="danger">{actionError ?? error}</Notice>
        ) : published ? (
          <Notice tone="success">{published}</Notice>
        ) : (
          <span />
        )}
        <DataTable
          label={t('courses.title_plural')}
          rows={data}
          sort={sort}
          onSortChange={setSort}
          selectionMode="single"
          selected={selected}
          onSelectionChange={setSelected}
          onRowAction={(id) => void navigate(`/author/courses/${id}`)}
          empty={t('courses.empty')}
          columns={[
            {
              id: 'title',
              label: t('courses.title'),
              sortable: true,
              isRowHeader: true,
              render: (c) => c.title,
            },
            { id: 'owner', label: t('courses.owner'), render: (c) => c.ownerName },
            { id: 'nodes', label: t('courses.nodes'), numeric: true, render: (c) => c.nodeCount },
            {
              id: 'lock',
              label: t('courses.editing'),
              render: (c) => (c.lockedBy ? <Badge tone="warning">{c.lockedBy}</Badge> : ''),
            },
            {
              id: 'updated',
              label: t('courses.updated'),
              sortable: true,
              numeric: true,
              render: (c) => formatDateTime(c.updatedAt),
            },
          ]}
        />
      </div>
      {importing ? (
        <ImportDialog
          fileName={importing.name}
          conversionId={importing.id}
          uploadError={importing.error}
          onClose={() => {
            setImporting(null);
            reload();
          }}
        />
      ) : null}
      {dialog === 'new' ? <NewCourseDialog onClose={() => setDialog(null)} /> : null}
      {dialog === 'archive' && current ? (
        <ConfirmDialog
          title={t('courses.archive')}
          text={t('courses.archiveConfirm', { title: current.title })}
          action={t('courses.archive')}
          onClose={() => setDialog(null)}
          onConfirm={() =>
            void api(okSchema, `/api/courses/${current.id}`, { method: 'DELETE' })
              .then(() => {
                setDialog(null);
                setSelected(new Set());
                reload();
              })
              .catch((e: unknown) => setActionError(errorMessage(e)))
          }
        />
      ) : null}
    </Page>
  );
}
