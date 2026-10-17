// SPDX-License-Identifier: Apache-2.0
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../components/Icon.js';
import styles from './Editor.module.css';

export function Section({
  title,
  children,
  open: initial = true,
}: {
  title: string;
  children: ReactNode;
  open?: boolean;
}) {
  const [open, setOpen] = useState(initial);
  return (
    <div className={styles.section}>
      <button
        type="button"
        className={styles.sectionHeader}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Icon name={open ? 'chevron-down' : 'chevron-right'} />
        {title}
      </button>
      {open ? <div className={styles.form}>{children}</div> : null}
    </div>
  );
}

/** Numeric input that commits on blur/Enter; changes coalesce into one undo step. */
export function NumberInput({
  label,
  value,
  onChange,
  unit,
  min,
  max,
  prefix,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  unit?: string;
  min?: number;
  max?: number;
  prefix?: string;
}) {
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);
  const shown = focused ? text : String(Math.round(value * 100) / 100);
  const commit = () => {
    const n = Number(text.replace(',', '.'));
    if (Number.isFinite(n)) onChange(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n)));
  };
  return (
    <span className={styles.numberField}>
      {prefix ? (
        <span className={styles.fieldPrefix} aria-hidden="true">
          {prefix}
        </span>
      ) : null}
      <input
        aria-label={label}
        inputMode="decimal"
        value={shown}
        onFocus={() => {
          setText(String(value));
          setFocused(true);
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          commit();
          setFocused(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const step = (e.shiftKey ? 10 : 1) * (e.key === 'ArrowUp' ? 1 : -1);
            onChange(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, value + step)));
          }
        }}
      />
      {unit ? <span className={styles.fieldUnit}>{unit}</span> : null}
    </span>
  );
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <span className={styles.formLabel}>{label}</span>
      <div className={styles.formControl}>{children}</div>
    </>
  );
}

export function ColorInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | undefined;
  onChange: (v: string | undefined) => void;
}) {
  const { t } = useTranslation();
  const themes = ['theme:text', 'theme:accent', 'theme:background', 'theme:muted', 'theme:surface'];
  const hex = value && value.startsWith('#') ? value.slice(0, 7) : '#ffffff';
  return (
    <span className={styles.colorField}>
      <input type="color" aria-label={label} value={hex} onChange={(e) => onChange(e.target.value)} />
      <select
        aria-label={t('editor.props.themeColor')}
        value={value && !value.startsWith('#') ? value : value ? 'custom' : 'none'}
        onChange={(e) =>
          onChange(e.target.value === 'none' ? undefined : e.target.value === 'custom' ? hex : e.target.value)
        }
      >
        <option value="none">{t('editor.props.none')}</option>
        <option value="custom">{value?.startsWith('#') ? value : t('editor.props.custom')}</option>
        {themes.map((th) => (
          <option key={th} value={th}>
            {t(`editor.props.themes.${th.slice(6)}`)}
          </option>
        ))}
      </select>
    </span>
  );
}
