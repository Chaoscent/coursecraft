// SPDX-License-Identifier: Apache-2.0
import { useTranslation } from 'react-i18next';
import { Dialog } from '../components/Dialog.js';
import styles from './AppShell.module.css';

const SHORTCUTS = [
  { keys: ['?'], action: 'shortcuts.help' },
  { keys: ['Tab'], action: 'shortcuts.nextControl' },
  { keys: ['F10'], action: 'shortcuts.menu' },
  { keys: ['Esc'], action: 'shortcuts.close' },
  { keys: ['↑', '↓'], action: 'shortcuts.rows' },
  { keys: ['Space'], action: 'shortcuts.select' },
  { keys: ['Enter'], action: 'shortcuts.open' },
] as const;

export function ShortcutHelp({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Dialog title={t('menu.shortcuts')} isOpen={isOpen} onClose={onClose}>
      <table className={styles.shortcutTable}>
        <tbody>
          {SHORTCUTS.map((s) => (
            <tr key={s.action}>
              <td>
                {s.keys.map((k) => (
                  <kbd key={k}>{k}</kbd>
                ))}
              </td>
              <td>{t(s.action)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Dialog>
  );
}
