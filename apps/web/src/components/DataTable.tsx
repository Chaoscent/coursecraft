// SPDX-License-Identifier: Apache-2.0
import type { ReactNode } from 'react';
import {
  Cell,
  Column,
  Row,
  Table,
  TableBody,
  TableHeader,
  type Key,
  type Selection,
  type SortDescriptor,
} from 'react-aria-components';
import styles from './DataTable.module.css';
import { Icon } from './Icon.js';

export interface ColumnDef<T> {
  id: string;
  label: string;
  render: (row: T) => ReactNode;
  sortable?: boolean;
  numeric?: boolean;
  width?: number;
  isRowHeader?: boolean;
}

interface Props<T extends { id: string }> {
  label: string;
  columns: ColumnDef<T>[];
  rows: T[];
  sort?: SortDescriptor;
  onSortChange?: (sort: SortDescriptor) => void;
  selectionMode?: 'none' | 'single' | 'multiple';
  selected?: Selection;
  onSelectionChange?: (keys: Selection) => void;
  onRowAction?: (id: string) => void;
  empty: string;
}

/** Dense data table with sticky header, sorting, selection and keyboard navigation. */
export function DataTable<T extends { id: string }>(props: Props<T>) {
  const {
    label,
    columns,
    rows,
    sort,
    onSortChange,
    selectionMode = 'none',
    selected,
    onSelectionChange,
    onRowAction,
    empty,
  } = props;
  return (
    <div className={styles.wrap}>
      <Table
        aria-label={label}
        className={styles.table}
        {...(sort ? { sortDescriptor: sort } : {})}
        {...(onSortChange ? { onSortChange } : {})}
        selectionMode={selectionMode}
        {...(selected ? { selectedKeys: selected } : {})}
        {...(onSelectionChange ? { onSelectionChange } : {})}
      >
        <TableHeader className={styles.header}>
          {columns.map((c) => (
            <Column
              key={c.id}
              id={c.id}
              isRowHeader={c.isRowHeader ?? false}
              allowsSorting={c.sortable ?? false}
              className={`${styles.column} ${c.numeric ? styles.num : ''}`}
              {...(c.width ? { width: c.width } : {})}
            >
              {({ allowsSorting, sortDirection }) => (
                <span className={styles.columnLabel}>
                  {c.label}
                  {allowsSorting && sortDirection ? (
                    <Icon name={sortDirection === 'ascending' ? 'chevron-up' : 'chevron-down'} />
                  ) : null}
                </span>
              )}
            </Column>
          ))}
        </TableHeader>
        <TableBody items={rows} renderEmptyState={() => <div className={styles.empty}>{empty}</div>}>
          {(row) => (
            <Row
              id={row.id}
              className={styles.row}
              {...(onRowAction ? { onAction: () => onRowAction(row.id) } : {})}
            >
              {columns.map((c) => (
                <Cell key={c.id} className={`${styles.cell} ${c.numeric ? styles.num : ''}`}>
                  {c.render(row)}
                </Cell>
              ))}
            </Row>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

export type { Key, Selection, SortDescriptor };
