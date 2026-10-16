// SPDX-License-Identifier: Apache-2.0
import type { ReactNode } from 'react';
import { Dialog as AriaDialog, Heading, Modal, ModalOverlay } from 'react-aria-components';
import { useTranslation } from 'react-i18next';
import { ToolButton } from './Button.js';
import styles from './Dialog.module.css';

interface Props {
  title: string;
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: 'sm' | 'md' | 'lg';
  /** Submit handler; the body is wrapped in a form so Enter submits. */
  onSubmit?: () => void;
}

export function Dialog({ title, isOpen, onClose, children, footer, width = 'md', onSubmit }: Props) {
  const { t } = useTranslation();
  const body = (
    <>
      <div className={styles.body}>{children}</div>
      {footer ? <div className={styles.footer}>{footer}</div> : null}
    </>
  );
  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={(open) => !open && onClose()}
      isDismissable
      className={styles.overlay}
    >
      <Modal className={`${styles.modal} ${styles[width]}`}>
        <AriaDialog className={styles.dialog}>
          <div className={styles.title}>
            <Heading slot="title">{title}</Heading>
            <ToolButton icon="x" aria-label={t('common.close')} onPress={onClose} />
          </div>
          {onSubmit ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                onSubmit();
              }}
            >
              {body}
            </form>
          ) : (
            body
          )}
        </AriaDialog>
      </Modal>
    </ModalOverlay>
  );
}
