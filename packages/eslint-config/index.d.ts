// SPDX-License-Identifier: Apache-2.0
import type { Linter } from 'eslint';

export const SQL_HELPERS_FILE: string;
export const DB_CONNECTION_FILE: string;
export const securityRules: Linter.RulesRecord;
export function createConfig(options: { tsconfigRootDir: string }): Linter.Config[];
