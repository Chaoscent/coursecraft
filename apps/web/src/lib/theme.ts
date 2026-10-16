// SPDX-License-Identifier: Apache-2.0
/** Theme preference is a per-device convenience; storage may be unavailable. */
export type Theme = 'system' | 'light' | 'dark';
const KEY = 'lernwerk.theme';

export function loadTheme(): Theme {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(theme: Theme): void {
  if (theme === 'system') delete document.documentElement.dataset['theme'];
  else document.documentElement.dataset['theme'] = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Not persisted; the choice still applies to this page.
  }
}
