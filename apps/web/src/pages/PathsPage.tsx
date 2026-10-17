// SPDX-License-Identifier: Apache-2.0
import {
  libraryListResponseSchema,
  okSchema,
  pathDetailSchema,
  pathsResponseSchema,
  type PathDetail,
  type PathSummary,
} from '@coursecraft/shared';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client.js';
import { useSession } from '../api/session.js';
import { Badge } from '../components/Badge.js';
import { Button, ToolButton } from '../components/Button.js';
import { DataTable, type Selection } from '../components/DataTable.js';
import { Dialog } from '../components/Dialog.js';
import { Checkbox, FormGrid, FormRow, TextField } from '../components/Field.js';
import { Notice } from '../components/Notice.js';
import { Page, ToolbarSeparator } from '../components/Page.js';
import { errorMessage } from '../lib/errors.js';
import { useApi } from '../lib/useApi.js';
import { AssignDialog } from './LibraryPage.js';
import { ConfirmDialog } from './UsersPage.js';
import styles from './AdminPages.module.css';

function PathDialog({
  path,
  onClose,
  onSaved,
}: {
  path: PathDetail | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const items = useApi(
    useCallback(
      () =>
        api(libraryListResponseSchema, '/api/library', { query: { status: 'active' } }).then((r) => r.items),
      [],
    ),
  );
  const [title, setTitle] = useState(path?.title ?? '');
  const [description, setDescription] = useState(path?.description ?? '');
  const [sequential, setSequential] = useState(path?.sequential ?? true);
  const [archived, setArchived] = useState(path?.status === 'archived');
  const [steps, setSteps] = useState<{ itemId: string; title: string }[]>(path?.steps ?? []);
  const [error, setError] = useState<string | null>(null);
  const available = (items.data ?? []).filter((i) => !steps.some((s) => s.itemId === i.id));

  const move = (from: number, to: number) =>
    setSteps((list) => {
      const next = [...list];
      const [item] = next.splice(from, 1);
      if (item) next.splice(to, 0, item);
      return next;
    });

  const save = async () => {
    try {
      const body = {
        title,
        description,
        sequential,
        status: archived ? 'archived' : 'active',
        itemIds: steps.map((s) => s.itemId),
      };
      if (path) await api(pathDetailSchema, `/api/paths/${path.id}`, { method: 'PUT', body });
      else await api(pathDetailSchema, '/api/paths', { method: 'POST', body });
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <Dialog
      title={path ? t('paths.edit') : t('paths.new')}
      isOpen
      width="lg"
      onClose={onClose}
      onSubmit={() => void save()}
      footer={
        <>
          <Button onPress={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" isDisabled={!title.trim() || !steps.length}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <FormGrid wide>
        <TextField label={t('paths.name')} value={title} onChange={setTitle} isRequired autoFocus />
        <TextField label={t('paths.description')} multiline value={description} onChange={setDescription} />
        <FormRow label="">
          <Checkbox isSelected={sequential} onChange={setSequential}>
            {t('paths.sequential')}
          </Checkbox>
        </FormRow>
        {path ? (
          <FormRow label="">
            <Checkbox isSelected={archived} onChange={setArchived}>
              {t('paths.archived')}
            </Checkbox>
          </FormRow>
        ) : null}
        <FormRow label={t('paths.steps')}>
          <ol className={styles.pathSteps} aria-label={t('paths.steps')}>
            {steps.map((s, i) => (
              <li key={s.itemId}>
                <span className={styles.pathStepTitle}>
                  {i + 1}. {s.title}
                </span>
                <ToolButton
                  icon="chevron-up"
                  aria-label={t('editor.moveUp')}
                  isDisabled={i === 0}
                  onPress={() => move(i, i - 1)}
                />
                <ToolButton
                  icon="chevron-down"
                  aria-label={t('editor.moveDown')}
                  isDisabled={i === steps.length - 1}
                  onPress={() => move(i, i + 1)}
                />
                <ToolButton
                  icon="x"
                  aria-label={t('paths.removeStep', { title: s.title })}
                  onPress={() => setSteps((list) => list.filter((x) => x.itemId !== s.itemId))}
                />
              </li>
            ))}
            {steps.length === 0 ? <li className={styles.muted}>{t('paths.noSteps')}</li> : null}
          </ol>
        </FormRow>
        <FormRow label={t('paths.addStep')}>
          <div className={styles.pickList}>
            {available.map((i) => (
              <div key={i.id} className={styles.pickRow}>
                <span>{i.title}</span>
                <ToolButton
                  icon="plus"
                  aria-label={t('paths.addNamed', { title: i.title })}
                  onPress={() => setSteps((list) => [...list, { itemId: i.id, title: i.title }])}
                />
              </div>
            ))}
            {available.length === 0 ? <span className={styles.muted}>{t('paths.nothingToAdd')}</span> : null}
          </div>
        </FormRow>
      </FormGrid>
    </Dialog>
  );
}

/** Learning paths: ordered courses that are assigned together. */
export function PathsPage() {
  const { t } = useTranslation();
  const { can } = useSession();
  const [selected, setSelected] = useState<Selection>(new Set());
  const [dialog, setDialog] = useState<null | 'new' | 'edit' | 'assign' | 'delete'>(null);
  const [detail, setDetail] = useState<PathDetail | null>(null);
  const [actionError, setError] = useState<string | null>(null);
  const fetcher = useCallback(() => api(pathsResponseSchema, '/api/paths').then((r) => r.items), []);
  const { data, error: loadError, reload } = useApi(fetcher);
  const paths = useMemo<PathSummary[]>(() => data ?? [], [data]);
  const current = useMemo(() => {
    if (selected === 'all' || selected.size !== 1) return null;
    const [id] = [...selected];
    return paths.find((p) => p.id === id) ?? null;
  }, [selected, paths]);
  const manage = can('library.manage');
  const done = () => {
    setDialog(null);
    reload();
  };
  const openEdit = async () => {
    if (!current) return;
    try {
      setDetail(await api(pathDetailSchema, `/api/paths/${current.id}`));
      setDialog('edit');
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <Page
      title={t('paths.title')}
      meta={t('paths.count', { count: paths.length })}
      toolbar={
        <>
          <ToolButton icon="route" isDisabled={!manage} onPress={() => setDialog('new')}>
            {t('paths.new')}
          </ToolButton>
          <ToolbarSeparator />
          <ToolButton icon="pencil" isDisabled={!manage || !current} onPress={() => void openEdit()}>
            {t('paths.edit')}
          </ToolButton>
          <ToolButton
            icon="users"
            isDisabled={!can('assignments.manage') || !current}
            onPress={() => setDialog('assign')}
          >
            {t('paths.assign')}
          </ToolButton>
          <ToolButton icon="trash-2" isDisabled={!manage || !current} onPress={() => setDialog('delete')}>
            {t('paths.delete')}
          </ToolButton>
        </>
      }
    >
      <div className={styles.stack}>
        {(actionError ?? loadError) ? <Notice tone="danger">{actionError ?? loadError}</Notice> : <span />}
        <DataTable
          label={t('paths.title')}
          rows={paths}
          selectionMode="single"
          selected={selected}
          onSelectionChange={setSelected}
          empty={t('paths.empty')}
          columns={[
            { id: 'name', label: t('paths.name'), isRowHeader: true, render: (p) => p.title },
            { id: 'steps', label: t('paths.steps'), numeric: true, render: (p) => p.stepCount },
            {
              id: 'mode',
              label: t('paths.mode'),
              render: (p) => (p.sequential ? t('paths.inOrder') : t('paths.anyOrder')),
            },
            {
              id: 'assigned',
              label: t('paths.assignments'),
              numeric: true,
              render: (p) => p.assignmentCount,
            },
            {
              id: 'status',
              label: t('ai.status'),
              render: (p) => (
                <Badge tone={p.status === 'active' ? 'success' : 'neutral'}>
                  {p.status === 'active' ? t('ai.on') : t('paths.archivedBadge')}
                </Badge>
              ),
            },
          ]}
        />
      </div>
      {dialog === 'new' ? <PathDialog path={null} onClose={() => setDialog(null)} onSaved={done} /> : null}
      {dialog === 'edit' && detail ? (
        <PathDialog path={detail} onClose={() => setDialog(null)} onSaved={done} />
      ) : null}
      {dialog === 'assign' && current ? (
        <AssignDialog
          item={current}
          base="/api/paths"
          onClose={() => {
            setDialog(null);
            reload();
          }}
        />
      ) : null}
      {dialog === 'delete' && current ? (
        <ConfirmDialog
          title={t('paths.delete')}
          text={t('paths.deleteConfirm', { name: current.title })}
          action={t('paths.delete')}
          onClose={() => setDialog(null)}
          onConfirm={() =>
            void api(okSchema, `/api/paths/${current.id}`, { method: 'DELETE' })
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
