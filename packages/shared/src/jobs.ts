// SPDX-License-Identifier: Apache-2.0
/**
 * Queue names. The migrate step creates every queue, because the app and
 * converter database roles have no DDL rights.
 */
export const QUEUES = {
  pptxRender: 'convert.pptx-render',
  media: 'convert.media',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/** Queues processed by the isolated converter service. */
export const CONVERTER_QUEUES: readonly QueueName[] = [QUEUES.pptxRender, QUEUES.media];

export const PGBOSS_SCHEMA = 'pgboss';
