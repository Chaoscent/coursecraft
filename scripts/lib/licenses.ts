// SPDX-License-Identifier: Apache-2.0
/**
 * Licenses compatible with distributing Coursecraft under Apache-2.0.
 * MPL-2.0 is allowed only for unmodified, separate packages (pnpm never
 * patches dependencies in this repository).
 */
export const ALLOWED_LICENSES = new Set([
  'MIT',
  'MIT-0',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'Apache-2.0',
  'CC0-1.0',
  'Unlicense',
  'BlueOak-1.0.0',
  'MPL-2.0',
]);

/** Allowed only for the listed packages, each justified in docs/dependencies.md. */
export const RESTRICTED_LICENSES: Readonly<Record<string, readonly string[]>> = {
  'OFL-1.1': ['@ibm/plex-sans', '@ibm/plex-mono'],
  // Browser-support data used by build tools only; never shipped.
  'CC-BY-4.0': ['caniuse-lite'],
};

const normalize = (license: string) =>
  license
    .trim()
    .replace(/^\((.*)\)$/, '$1')
    .trim();

/**
 * Evaluates a simple SPDX expression: `A OR B` passes if any part passes,
 * `A AND B` only if all parts pass. Nested parentheses are not supported and
 * fail closed.
 */
export function isLicenseAllowed(expression: string, packageName: string): boolean {
  const expr = normalize(expression);
  if (expr.includes('(')) return false;
  if (/ OR /.test(expr)) return expr.split(/ OR /).some((part) => isLicenseAllowed(part, packageName));
  if (/ AND /.test(expr)) return expr.split(/ AND /).every((part) => isLicenseAllowed(part, packageName));
  if (ALLOWED_LICENSES.has(expr)) return true;
  return RESTRICTED_LICENSES[expr]?.includes(packageName) ?? false;
}
