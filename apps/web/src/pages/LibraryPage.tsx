// SPDX-License-Identifier: Apache-2.0
import {
  assignmentsResponseSchema,
  directoryResponseSchema,
  importPackageResponseSchema,
  libraryListResponseSchema,
  listGroupsResponseSchema,
  okSchema,
  type LibraryItem,
} from '@lernwerk/shared';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { z } from 'zod';
import { api } from '../api/client.js';
import { useSession } from '../api/session.js';
import { Badge } from '../components/Badge.js';
import { Button, ToolButton } from '../components/Button.js';
import { DataTable, type Selection } from '../components/DataTable.js';
import { Dialog } from '../components/Dialog.js';
import { Checkbox, FormGrid, FormRow, SelectField, TextField } from '../components/Field.js';
import { Notice } from '../components/Notice.js';
import { Page, ToolbarSeparator, ToolbarSpacer } from '../components/Page.js';
import { chooseFile } from '../editor/upload.js';
import { errorMessage } from '../lib/errors.js';
import { formatDateTime } from '../lib/format.js';
import { useApi } from '../lib/useApi.js';
import styles from './AdminPages.module.css';

const EMPTY: LibraryItem[] = [];

function AssignDialog({ item, onClose }: { item: LibraryItem; onClose: () => void }) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [users, setUsers] = useState<Set<string>>(new Set());
  const [groups, setGroups] = useState<Set<string>>(new Set());
  const [due, setDue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const directory = useApi(
    useCallback(
      () => api(directoryResponseSchema, '/api/directory/users', { query: { q } }).then((r) => r.items),
      [q],
    ),
  );
  const groupList = useApi(
    useCallback(() => api(listGroupsResponseSchema, '/api/groups').then((r) => r.items), []),
  );
  const existing = useApi(
    useCallback(
      () => api(assignmentsResponseSchema, `/api/library/${item.id}/assignments`).then((r) => r.items),
      [item.id],
    ),
  );
  const toggle = (set: Set<string>, id: string, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(id);
    else next.delete(id);
    return next;
  };
  const save = async () => {
    try {
      await api(z.object({ count: z.number() }), `/api/library/${item.id}/assignments`, {
        method: 'POST',
        body: {
          userIds: [...users],
          groupIds: [...groups],
          dueAt: due ? new Date(`${due}T23:59:00`).toISOString() : null,
        },
      });
      setUsers(new Set());
      setGroups(new Set());
      existing.reload();
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <Dialog
      title={t('library.assignTitle', { title: item.title })}
      isOpen
      width="lg"
      onClose={onClose}
      onSubmit={() => void save()}
      footer={
        <>
          <Button onPress={onClose}>{t('common.close')}</Button>
          <Button type="submit" variant="primary" isDisabled={!users.size && !groups.size}>
            {t('library.assign')}
          </Button>
        </>
      }
    >
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <FormGrid wide>
        <FormRow label={t('library.groups')}>
          <div className={styles.pickList}>
            {(groupList.data ?? []).map((g) => (
              <div key={g.id}>
                <Checkbox
                  isSelected={groups.has(g.id)}
                  onChange={(on) => setGroups(toggle(groups, g.id, on))}
                >
                  {g.name}
                </Checkbox>
              </div>
            ))}
          </div>
        </FormRow>
        <TextField label={t('library.findUser')} type="search" value={q} onChange={setQ} />
        <FormRow label={t('library.users')}>
          <div className={styles.pickList}>
            {(directory.data ?? []).map((u) => (
              <div key={u.id}>
                <Checkbox isSelected={users.has(u.id)} onChange={(on) => setUsers(toggle(users, u.id, on))}>
                  {u.displayName} <span className={styles.muted}>{u.email}</span>
                </Checkbox>
              </div>
            ))}
          </div>
        </FormRow>
        <TextField label={t('library.dueDate')} type="date" value={due} onChange={setDue} />
      </FormGrid>
      <h3 className={styles.sectionTitle}>{t('library.current')}</h3>
      <DataTable
        label={t('library.current')}
        rows={existing.data ?? []}
        empty={t('library.noAssignments')}
        columns={[
          { id: 'target', label: t('library.target'), isRowHeader: true, render: (a) => a.targetName },
          { id: 'type', label: t('library.type'), render: (a) => t(`library.targetType.${a.targetType}`) },
          { id: 'due', label: t('library.dueDate'), render: (a) => formatDateTime(a.dueAt) },
          {
            id: 'remove',
            label: t('library.remove'),
            render: (a) => (
              <Button
                icon="trash-2"
                onPress={() =>
                  void api(okSchema, `/api/library/${item.id}/assignments/${a.id}`, { method: 'DELETE' })
                    .then(() => existing.reload())
                    .catch((e: unknown) => setError(errorMessage(e)))
                }
              >
                {t('library.remove')}
              </Button>
            ),
          },
        ]}
      />
    </Dialog>
  );
}

/** Published own courses and imported packages; assignment and reports start here. */
export function LibraryPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { can } = useSession();
  const [status, setStatus] = useState<'active' | 'archived'>('active');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Selection>(new Set());
  const [dialog, setDialog] = useState<'assign' | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger' | 'warning'; text: string } | null>(
    null,
  );
  const fetcher = useCallback(
    () => api(libraryListResponseSchema, '/api/library', { query: { status, q } }),
    [status, q],
  );
  const { data, error, reload } = useApi(fetcher);
  const items = data?.items ?? EMPTY;
  const current = useMemo(() => {
    if (selected === 'all' || selected.size !== 1) return null;
    const [id] = [...selected];
    return items.find((i) => i.id === id) ?? null;
  }, [selected, items]);

  const importPackage = async () => {
    const file = await chooseFile('.zip,application/zip');
    if (!file) return;
    const form = new FormData();
    form.append('file', file, file.name);
    setMessage(null);
    try {
      const result = await api(importPackageResponseSchema, '/api/library/import', { method: 'POST', form });
      setMessage({
        tone: result.multipleUnits ? 'warning' : 'success',
        text: result.multipleUnits
          ? t('library.importedMulti', { title: result.title })
          : t('library.imported', { title: result.title }),
      });
      reload();
    } catch (e) {
      setMessage({ tone: 'danger', text: errorMessage(e) });
    }
  };

  const setItemStatus = (next: 'active' | 'archived') =>
    current &&
    void api(okSchema, `/api/library/${current.id}`, { method: 'PATCH', body: { status: next } })
      .then(() => {
        setSelected(new Set());
        reload();
      })
      .catch((e: unknown) => setMessage({ tone: 'danger', text: errorMessage(e) }));

  return (
    <Page
      title={t('library.title')}
      meta={t('library.count', { count: items.length })}
      toolbar={
        <>
          {can('library.manage') ? (
            <ToolButton
              icon="file-up"
              isDisabled={!data?.foreignPackagesEnabled}
              onPress={() => void importPackage()}
            >
              {t('library.import')}
            </ToolButton>
          ) : null}
          <ToolbarSeparator />
          {can('assignments.manage') ? (
            <ToolButton
              icon="user-plus"
              isDisabled={!current || status === 'archived'}
              onPress={() => setDialog('assign')}
            >
              {t('library.assignAction')}
            </ToolButton>
          ) : null}
          {can('reports.read') ? (
            <ToolButton
              icon="bar-chart-3"
              isDisabled={!current}
              onPress={() => current && void navigate(`/library/${current.id}/report`)}
            >
              {t('library.report')}
            </ToolButton>
          ) : null}
          {can('library.manage') ? (
            <ToolButton
              icon="archive"
              isDisabled={!current}
              onPress={() => setItemStatus(status === 'active' ? 'archived' : 'active')}
            >
              {status === 'active' ? t('library.archive') : t('library.restore')}
            </ToolButton>
          ) : null}
          <ToolbarSpacer />
          <div className={styles.filter}>
            <TextField label={t('common.search')} type="search" value={q} onChange={setQ} />
          </div>
          <div className={styles.filter}>
            <SelectField
              label={t('library.status')}
              value={status}
              onChange={(next) => {
                setStatus(next);
                setSelected(new Set());
              }}
              options={[
                { id: 'active', label: t('library.active') },
                { id: 'archived', label: t('library.archived') },
              ]}
            />
          </div>
        </>
      }
    >
      <div className={styles.stack}>
        <div>
          {error ? <Notice tone="danger">{error}</Notice> : null}
          {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
          {data && !data.foreignPackagesEnabled && can('library.manage') ? (
            <Notice tone="info">{t('library.noContentOrigin')}</Notice>
          ) : null}
        </div>
        <DataTable
          label={t('library.title')}
          rows={items}
          selectionMode="single"
          selected={selected}
          onSelectionChange={setSelected}
          empty={t('library.empty')}
          columns={[
            { id: 'title', label: t('library.itemTitle'), isRowHeader: true, render: (i) => i.title },
            {
              id: 'kind',
              label: t('library.kind'),
              render: (i) => (
                <Badge>
                  {t(`library.kinds.${i.kind}`)}
                  {i.sourceVersion ? ` v${i.sourceVersion}` : ''}
                </Badge>
              ),
            },
            {
              id: 'assignments',
              label: t('library.assignments'),
              numeric: true,
              render: (i) => i.assignmentCount,
            },
            { id: 'learners', label: t('library.learners'), numeric: true, render: (i) => i.learnerCount },
            {
              id: 'completed',
              label: t('library.completed'),
              numeric: true,
              render: (i) => i.completedCount,
            },
            {
              id: 'updated',
              label: t('library.updated'),
              numeric: true,
              render: (i) => formatDateTime(i.updatedAt),
            },
          ]}
        />
      </div>
      {dialog === 'assign' && current ? (
        <AssignDialog
          item={current}
          onClose={() => {
            setDialog(null);
            reload();
          }}
        />
      ) : null}
    </Page>
  );
}
