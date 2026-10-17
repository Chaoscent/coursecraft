// SPDX-License-Identifier: Apache-2.0
// Form building blocks shared by the quiz, survey, interaction and dialog editors.
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ToolButton } from '../components/Button.js';
import { useEditor } from './context.js';
import styles from './Editor.module.css';

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <span className={styles.formLabel}>{label}</span>
      <div className={styles.formControl}>{children}</div>
    </>
  );
}

export function TextInput({
  label,
  value,
  onChange,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
}) {
  return multiline ? (
    <textarea
      className={styles.textarea}
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ) : (
    <input
      className={styles.textInput}
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function NumberInput({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <input
      className={styles.textInput}
      aria-label={label}
      type="number"
      min={min}
      max={max}
      step={step}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
    />
  );
}

/** Rows editor for lists (choices, pairs, items) with add/remove/move. */
export function ListEditor<T>({
  items,
  render,
  onAdd,
  onRemove,
  onMove,
  addLabel,
  min = 1,
}: {
  items: readonly T[];
  render: (item: T, index: number) => ReactNode;
  onAdd?: () => void;
  onRemove: (index: number) => void;
  onMove?: (from: number, to: number) => void;
  addLabel: string;
  min?: number;
}) {
  const { t } = useTranslation();
  const readOnly = useEditor((s) => s.readOnly);
  return (
    <div className={styles.listEditor}>
      {items.map((item, i) => (
        <div className={styles.listRow} key={i}>
          <div className={styles.listRowMain}>{render(item, i)}</div>
          {onMove ? (
            <>
              <ToolButton
                icon="chevron-up"
                aria-label={t('editor.moveUp')}
                isDisabled={readOnly || i === 0}
                onPress={() => onMove(i, i - 1)}
              />
              <ToolButton
                icon="chevron-down"
                aria-label={t('editor.moveDown')}
                isDisabled={readOnly || i === items.length - 1}
                onPress={() => onMove(i, i + 1)}
              />
            </>
          ) : null}
          <ToolButton
            icon="trash-2"
            aria-label={t('editor.delete')}
            isDisabled={readOnly || items.length <= min}
            onPress={() => onRemove(i)}
          />
        </div>
      ))}
      {onAdd ? (
        <div>
          <Button icon="plus" isDisabled={readOnly} onPress={onAdd}>
            {addLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function move<T>(list: T[], from: number, to: number) {
  const [item] = list.splice(from, 1);
  if (item !== undefined) list.splice(to, 0, item);
}
