// SPDX-License-Identifier: Apache-2.0
import type { TestProject } from 'vitest/node';
import { startPostgres, type PgInfo } from './postgres.js';

declare module 'vitest' {
  export interface ProvidedContext {
    pg: PgInfo;
  }
}

export default async function setup(project: TestProject) {
  const { container, info } = await startPostgres();
  project.provide('pg', info);
  return async () => {
    await container.stop();
  };
}
