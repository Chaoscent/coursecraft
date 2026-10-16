// SPDX-License-Identifier: Apache-2.0
import {
  groupSchema,
  listGroupsResponseSchema,
  listUsersResponseSchema,
  okSchema,
  type Group,
  type User,
} from '@lernwerk/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client.js';
import { Button, ToolButton } from '../components/Button.js';
import { DataTable, type Selection } from '../components/DataTable.js';
import { Dialog } from '../components/Dialog.js';
import { FormGrid, SelectField, TextField } from '../components/Field.js';
import { Notice } from '../components/Notice.js';
import { Page, ToolbarSeparator } from '../components/Page.js';
import { errorMessage } from '../lib/errors.js';
import { useApi } from '../lib/useApi.js';
import { ConfirmDialog } from './UsersPage.js';
import styles from './AdminPages.module.css';

const NO_PARENT = '__none__';

function GroupDialog({
  group,
  groups,
  onClose,
  onSaved,
}: {
  group: Group | null;
  groups: Group[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(group?.name ?? '');
  const [parent, setParent] = useState(group?.parentId ?? NO_PARENT);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    try {
      const body = { name, parentId: parent === NO_PARENT ? null : parent };
      if (group) await api(groupSchema, `/api/groups/${group.id}`, { method: 'PATCH', body });
      else await api(groupSchema, '/api/groups', { method: 'POST', body });
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <Dialog
      title={group ? t('groups.edit') : t('groups.new')}
      isOpen
      onClose={onClose}
      width="sm"
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
      <FormGrid>
        <TextField label={t('groups.name')} value={name} onChange={setName} isRequired autoFocus />
        <SelectField
          label={t('groups.parent')}
          value={parent}
          onChange={setParent}
          options={[
            { id: NO_PARENT, label: t('groups.noParent') },
            ...groups.filter((g) => g.id !== group?.id).map((g) => ({ id: g.id, label: g.name })),
          ]}
        />
      </FormGrid>
    </Dialog>
  );
}

function Members({ group, onChanged }: { group: Group; onChanged: () => void }) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [candidates, setCandidates] = useState<User[]>([]);

  const fetchMembers = useCallback(
    () =>
      api(listUsersResponseSchema, '/api/users', { query: { groupId: group.id, pageSize: 200 } }).then(
        (r) => r.items,
      ),
    [group.id],
  );
  const { data: members = [], reload: load } = useApi(fetchMembers);
  const searching = q.trim().length >= 2;
  useEffect(() => {
    if (!searching) return;
    const timer = setTimeout(() => {
      void api(listUsersResponseSchema, '/api/users', { query: { q, pageSize: 10 } }).then((r) =>
        setCandidates(r.items.filter((u) => !u.groups.some((g) => g.id === group.id))),
      );
    }, 200);
    return () => clearTimeout(timer);
  }, [q, searching, group.id]);

  const add = async (userId: string) => {
    await api(okSchema, `/api/groups/${group.id}/members`, { method: 'POST', body: { userIds: [userId] } });
    setQ('');
    load();
    onChanged();
  };
  const remove = async (userId: string) => {
    await api(okSchema, `/api/groups/${group.id}/members/remove`, {
      method: 'POST',
      body: { userIds: [userId] },
    });
    load();
    onChanged();
  };

  return (
    <aside className={styles.side} aria-label={t('groups.members')}>
      <h2>
        {t('groups.members')}: {group.name}
      </h2>
      <div className={styles.memberList}>
        {members.map((m) => (
          <div key={m.id} className={styles.member}>
            <span>{m.displayName}</span>
            <ToolButton
              icon="x"
              aria-label={t('groups.removeMember', { name: m.displayName })}
              onPress={() => void remove(m.id)}
            />
          </div>
        ))}
        {members.length === 0 ? <div className={styles.member}>{t('groups.noMembers')}</div> : null}
      </div>
      <div>
        <TextField label={t('groups.addMember')} type="search" value={q} onChange={setQ} />
        <div className={styles.memberList}>
          {(searching ? candidates : []).map((c) => (
            <div key={c.id} className={styles.member}>
              <span>
                {c.displayName} <span className={styles.muted}>{c.email}</span>
              </span>
              <ToolButton
                icon="plus"
                aria-label={t('groups.addNamed', { name: c.displayName })}
                onPress={() => void add(c.id)}
              />
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}

export function GroupsPage() {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<Selection>(new Set());
  const [dialog, setDialog] = useState<null | 'new' | 'edit' | 'delete'>(null);
  const [actionError, setError] = useState<string | null>(null);

  const fetchGroups = useCallback(
    () => api(listGroupsResponseSchema, '/api/groups').then((r) => r.items),
    [],
  );
  const groupsQuery = useApi(fetchGroups);
  const groups = useMemo(() => groupsQuery.data ?? [], [groupsQuery.data]);
  const load = groupsQuery.reload;
  const error = actionError ?? groupsQuery.error;

  const current = useMemo(() => {
    if (selected === 'all' || selected.size !== 1) return null;
    const [id] = [...selected];
    return groups.find((g) => g.id === id) ?? null;
  }, [selected, groups]);
  const byId = new Map(groups.map((g) => [g.id, g]));

  const done = () => {
    setDialog(null);
    load();
  };

  return (
    <Page
      title={t('groups.title')}
      meta={t('groups.count', { count: groups.length })}
      toolbar={
        <>
          <ToolButton icon="folder-plus" onPress={() => setDialog('new')}>
            {t('groups.new')}
          </ToolButton>
          <ToolbarSeparator />
          <ToolButton icon="pencil" isDisabled={!current} onPress={() => setDialog('edit')}>
            {t('groups.edit')}
          </ToolButton>
          <ToolButton icon="trash-2" isDisabled={!current} onPress={() => setDialog('delete')}>
            {t('groups.delete')}
          </ToolButton>
        </>
      }
    >
      <div className={current ? styles.split : styles.stack}>
        <div className={styles.stack}>
          {error ? <Notice tone="danger">{error}</Notice> : <span />}
          <DataTable
            label={t('groups.title')}
            rows={groups}
            selectionMode="single"
            selected={selected}
            onSelectionChange={setSelected}
            empty={t('groups.empty')}
            columns={[
              { id: 'name', label: t('groups.name'), isRowHeader: true, render: (g) => g.name },
              {
                id: 'parent',
                label: t('groups.parent'),
                render: (g) => (g.parentId ? (byId.get(g.parentId)?.name ?? '') : ''),
              },
              { id: 'members', label: t('groups.members'), numeric: true, render: (g) => g.memberCount },
            ]}
          />
        </div>
        {current ? <Members key={current.id} group={current} onChanged={load} /> : null}
      </div>
      {dialog === 'new' ? (
        <GroupDialog group={null} groups={groups} onClose={() => setDialog(null)} onSaved={done} />
      ) : null}
      {dialog === 'edit' && current ? (
        <GroupDialog group={current} groups={groups} onClose={() => setDialog(null)} onSaved={done} />
      ) : null}
      {dialog === 'delete' && current ? (
        <ConfirmDialog
          title={t('groups.delete')}
          text={t('groups.deleteConfirm', { name: current.name })}
          action={t('groups.delete')}
          onClose={() => setDialog(null)}
          onConfirm={() =>
            void api(okSchema, `/api/groups/${current.id}`, { method: 'DELETE' })
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
