// SPDX-License-Identifier: Apache-2.0
export const ERROR_CODES = [
  'bad_request',
  'invalid_credentials',
  'password_change_required',
  'unauthenticated',
  'forbidden',
  'not_found',
  'conflict',
  'rate_limited',
  'payload_too_large',
  'unsupported_media_type',
  'invalid_file',
  'quota_exceeded',
  'upstream_failed',
  'internal',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ErrorBody {
  error: { code: ErrorCode; message: string; requestId: string };
}
