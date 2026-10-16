// SPDX-License-Identifier: Apache-2.0
import type { ReactNode } from 'react';
import styles from './Page.module.css';

/** Standard management page: header, optional toolbar, content, optional footer (pager). */
export function Page({
  title,
  meta,
  toolbar,
  children,
  footer,
}: {
  title: string;
  meta?: ReactNode;
  toolbar?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section className={styles.page} aria-labelledby="page-title">
      <header className={styles.header}>
        <h1 id="page-title">{title}</h1>
        {meta ? <span className={styles.meta}>{meta}</span> : null}
      </header>
      {toolbar ? (
        <div className={styles.toolbar} role="toolbar" aria-label={title}>
          {toolbar}
        </div>
      ) : null}
      <div className={styles.content}>{children}</div>
      {footer ? <footer className={styles.footer}>{footer}</footer> : null}
    </section>
  );
}

export function ToolbarSeparator() {
  return <span className={styles.separator} aria-hidden="true" />;
}

export function ToolbarSpacer() {
  return <span className={styles.spacer} />;
}

/** Scrollable form content area with a maximum readable width. */
export function PageBody({ children }: { children: ReactNode }) {
  return <div className={styles.body}>{children}</div>;
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}
