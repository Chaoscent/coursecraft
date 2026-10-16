// SPDX-License-Identifier: Apache-2.0
import type { ReactNode } from 'react';
import { Icon } from './Icon.js';
import styles from './Notice.module.css';

const ICON = {
  info: 'info',
  warning: 'triangle-alert',
  danger: 'circle-x',
  success: 'circle-check',
} as const;

/** Inline status message; errors are announced to screen readers. */
export function Notice({ tone = 'info', children }: { tone?: keyof typeof ICON; children: ReactNode }) {
  return (
    <div className={`${styles.notice} ${styles[tone]}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon name={ICON[tone]} />
      <div>{children}</div>
    </div>
  );
}
