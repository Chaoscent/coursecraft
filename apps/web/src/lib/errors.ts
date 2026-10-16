// SPDX-License-Identifier: Apache-2.0
import { ApiError } from '../api/client.js';
import { i18n } from '../i18n/index.js';

/** User-facing message for an API error, translated by error code. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const key = `errors.${error.code}`;
    return i18n.exists(key) ? i18n.t(key) : error.message;
  }
  return i18n.t('errors.internal');
}
