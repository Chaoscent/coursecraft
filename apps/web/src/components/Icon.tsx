// SPDX-License-Identifier: Apache-2.0
import type { CSSProperties } from 'react';
import styles from './Icon.module.css';

const urls = import.meta.glob<string>('../assets/icons/*.svg', {
  query: '?url',
  import: 'default',
  eager: true,
});
const ICONS = new Map(
  Object.entries(urls).map(([path, url]) => [path.replace(/^.*\/(.+)\.svg$/, '$1'), url]),
);

export type IconName = string;

/**
 * Line icon drawn as a CSS mask in the current text color. Decorative by
 * default; icon-only controls carry their own accessible label.
 */
export function Icon({ name, size = 'md' }: { name: IconName; size?: 'md' | 'lg' }) {
  const url = ICONS.get(name);
  // Set through the CSSOM (React style prop), which the CSP allows.
  const style = { '--icon': url ? `url("${url}")` : 'none' } as CSSProperties;
  return (
    <span className={`${styles.icon} ${size === 'lg' ? styles.lg : ''}`} style={style} aria-hidden="true" />
  );
}
