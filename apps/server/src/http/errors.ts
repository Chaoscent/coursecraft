// SPDX-License-Identifier: Apache-2.0
import type { ErrorCode } from '@lernwerk/shared';

const STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  invalid_credentials: 401,
  password_change_required: 403,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  payload_too_large: 413,
  unsupported_media_type: 415,
  internal: 500,
};

/** Expected errors with a stable code; the message is safe to show to users. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;

  constructor(code: ErrorCode, message: string = code) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS[code];
  }
}

export const notFound = (what = 'Not found') => new AppError('not_found', what);
export const forbidden = (why = 'Forbidden') => new AppError('forbidden', why);
export const conflict = (why: string) => new AppError('conflict', why);
export const badRequest = (why: string) => new AppError('bad_request', why);
