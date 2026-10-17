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

const EDITOR_SHORTCUTS = [
  { keys: ['Ctrl', 'Z'], action: 'shortcuts.undo' },
  { keys: ['Ctrl', 'Y'], action: 'shortcuts.redo' },
  { keys: ['Ctrl', 'C'], action: 'shortcuts.copy' },
  { keys: ['Ctrl', 'V'], action: 'shortcuts.paste' },
  { keys: ['Ctrl', 'M'], action: 'shortcuts.newSlide' },
  { keys: ['Ctrl', 'D'], action: 'shortcuts.duplicate' },
  { keys: ['Entf'], action: 'shortcuts.delete' },
  { keys: ['↑', '↓', '←', '→'], action: 'shortcuts.nudge' },
  { keys: ['Shift', '↑'], action: 'shortcuts.nudgeFar' },
  { keys: ['Enter'], action: 'shortcuts.editText' },
  { keys: ['Esc'], action: 'shortcuts.deselect' },
  { keys: ['Ctrl', 'A'], action: 'shortcuts.selectAll' },
  { keys: ['Ctrl', 'G'], action: 'shortcuts.group' },
  { keys: ['Ctrl', ']'], action: 'shortcuts.forward' },
  { keys: ['Ctrl', 'S'], action: 'shortcuts.version' },
  { keys: ['F5'], action: 'shortcuts.preview' },
  { keys: ['Alt'], action: 'shortcuts.noSnap' },
] as const;

export function ShortcutHelp({
  isOpen,
  onClose,
  editor,
}: {
  isOpen: boolean;
  onClose: () => void;
  editor?: boolean;
}) {
  const { t } = useTranslation();
  const list = editor ? [...EDITOR_SHORTCUTS, ...SHORTCUTS] : SHORTCUTS;
  return (
    <Dialog title={t('menu.shortcuts')} isOpen={isOpen} onClose={onClose}>
      <table className={styles.shortcutTable}>
        <tbody>
          {list.map((s) => (
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
