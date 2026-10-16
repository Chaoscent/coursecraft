// SPDX-License-Identifier: Apache-2.0
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './AuthFrame.module.css';

/** Sign-in and setup: a dialog window on the empty workspace, like a desktop application. */
export function AuthFrame({
  title,
  children,
  footer,
}: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className={styles.frame}>
      <div className={styles.menubar}>
        <span className={styles.brand}>{t('app.name')}</span>
      </div>
      <div className={styles.workspace}>
        <section className={styles.window} aria-labelledby="auth-title">
          <h1 id="auth-title" className={styles.title}>
            {title}
          </h1>
          <div className={styles.body}>{children}</div>
          {footer ? <div className={styles.footer}>{footer}</div> : null}
        </section>
      </div>
      <div className={styles.statusbar} />
    </div>
  );
}
