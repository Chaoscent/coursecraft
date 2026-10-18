// SPDX-License-Identifier: Apache-2.0
import type { Permission } from '@coursecraft/shared';
import { useEffect, useState, type ReactNode } from 'react';
import {
  Button as AriaButton,
  Menu,
  MenuItem,
  MenuTrigger,
  Popover,
  Separator,
  type Key,
} from 'react-aria-components';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { logoutResponseSchema } from '@coursecraft/shared';
import { api } from '../api/client.js';
import { useSession } from '../api/session.js';
import { Icon } from '../components/Icon.js';
import { ShortcutHelp } from './ShortcutHelp.js';
import { applyTheme, loadTheme, type Theme } from '../lib/theme.js';
import styles from './AppShell.module.css';

interface NavEntry {
  to: string;
  icon: string;
  label: string;
  permission: Permission;
}

interface MenuEntry {
  id: string;
  label: string;
  shortcut?: string;
  onAction: () => void;
}

function TopMenu({
  label,
  items,
  align = 'bottom start',
}: {
  label: ReactNode;
  items: (MenuEntry | 'separator')[];
  align?: 'bottom start' | 'bottom end';
}) {
  return (
    <MenuTrigger>
      <AriaButton className={styles.menuButton}>{label}</AriaButton>
      <Popover className={styles.menuPopover} placement={align} offset={0}>
        <Menu
          className={styles.menu}
          onAction={(key: Key) =>
            items.find((i): i is MenuEntry => i !== 'separator' && i.id === key)?.onAction()
          }
        >
          {items.map((item, index) =>
            item === 'separator' ? (
              <Separator key={`s${index}`} className={styles.menuSeparator} />
            ) : (
              <MenuItem key={item.id} id={item.id} className={styles.menuItem}>
                <span>{item.label}</span>
                <kbd className={styles.shortcut}>{item.shortcut ?? ''}</kbd>
              </MenuItem>
            ),
          )}
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}

export function AppShell() {
  const { t, i18n } = useTranslation();
  const { session, setSession, can } = useSession();
  const navigate = useNavigate();
  const [theme, setTheme] = useState<Theme>(loadTheme);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => applyTheme(theme), [theme]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;
      if (event.key === '?') {
        event.preventDefault();
        setHelpOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!session) return null;
  const user = session.user;

  const logout = async () => {
    const result = await api(logoutResponseSchema, '/api/auth/logout', { method: 'POST' }).catch(() => null);
    setSession(null);
    // Single logout: continue at the identity provider, which sends the browser back to /login.
    if (result?.redirect) window.location.assign(result.redirect);
    else void navigate('/login');
  };

  const nav: { group: string; entries: NavEntry[] }[] = [
    {
      group: t('nav.learn'),
      entries: [
        { to: '/', icon: 'book-open', label: t('nav.myCourses'), permission: 'learning.participate' },
      ],
    },
    {
      group: t('nav.author'),
      entries: [
        { to: '/author', icon: 'presentation', label: t('nav.courses'), permission: 'courses.author' },
      ],
    },
    {
      group: t('nav.manage'),
      entries: [
        { to: '/library', icon: 'gallery-vertical-end', label: t('nav.library'), permission: 'library.view' },
        { to: '/paths', icon: 'route', label: t('nav.paths'), permission: 'library.view' },
        { to: '/grading', icon: 'square-check', label: t('nav.grading'), permission: 'grading.perform' },
      ],
    },
    {
      group: t('nav.admin'),
      entries: [
        { to: '/admin/users', icon: 'users', label: t('nav.users'), permission: 'users.manage' },
        { to: '/admin/groups', icon: 'folder', label: t('nav.groups'), permission: 'groups.manage' },
        { to: '/admin/sso', icon: 'key-round', label: t('nav.sso'), permission: 'settings.manage' },
        { to: '/admin/mail', icon: 'mail', label: t('nav.mail'), permission: 'settings.manage' },
        { to: '/admin/ai', icon: 'message-square', label: t('nav.ai'), permission: 'settings.manage' },
        { to: '/admin/audit', icon: 'history', label: t('nav.audit'), permission: 'audit.read' },
      ],
    },
  ];

  return (
    <div className={styles.app}>
      <nav className={styles.menubar} aria-label={t('shell.mainMenu')}>
        <span className={styles.brand}>{t('app.name')}</span>
        <TopMenu
          label={t('menu.view')}
          items={[
            { id: 'light', label: t('menu.themeLight'), onAction: () => setTheme('light') },
            { id: 'dark', label: t('menu.themeDark'), onAction: () => setTheme('dark') },
            { id: 'system', label: t('menu.themeSystem'), onAction: () => setTheme('system') },
          ]}
        />
        <TopMenu
          label={t('menu.help')}
          items={[
            { id: 'shortcuts', label: t('menu.shortcuts'), shortcut: '?', onAction: () => setHelpOpen(true) },
          ]}
        />
        <span className={styles.spacer} />
        <TopMenu
          align="bottom end"
          label={
            <span className={styles.user}>
              <Icon name="user" />
              {user.displayName}
            </span>
          }
          items={[
            { id: 'account', label: t('menu.account'), onAction: () => void navigate('/account') },
            'separator',
            { id: 'logout', label: t('menu.logout'), onAction: () => void logout() },
          ]}
        />
      </nav>

      <div className={styles.body}>
        <aside className={styles.nav} aria-label={t('shell.navigation')}>
          {nav.map((section) => {
            const visible = section.entries.filter((e) => can(e.permission));
            if (!visible.length) return null;
            return (
              <div key={section.group}>
                <div className={styles.navGroup}>{section.group}</div>
                {visible.map((entry) => (
                  <NavLink key={entry.to} to={entry.to} end className={styles.navItem}>
                    <Icon name={entry.icon} />
                    {entry.label}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </aside>
        <main className={styles.main}>
          <Outlet />
        </main>
      </div>

      <footer className={styles.statusbar}>
        <span className={styles.statusItem}>
          <span className={styles.dot} aria-hidden="true" />
          {t('shell.connected')}
        </span>
        <span className={`${styles.statusItem} ${styles.end}`}>
          {user.roles.map((r) => t(`roles.${r}`)).join(', ')}
        </span>
        <span className={styles.statusItem}>{i18n.language.toUpperCase()}</span>
        <span className={styles.statusItem}>
          <kbd>?</kbd> {t('menu.shortcuts')}
        </span>
      </footer>
      <ShortcutHelp isOpen={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
