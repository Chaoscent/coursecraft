// SPDX-License-Identifier: Apache-2.0
import { i18n } from '../i18n/index.js';

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '–';
  return new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat(i18n.language).format(value);
}
