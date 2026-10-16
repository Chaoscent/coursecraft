// SPDX-License-Identifier: Apache-2.0
/**
 * Fails when an npm dependency (any workspace, dev included) has a license
 * outside the allowlist, and validates the list of system binaries.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { isLicenseAllowed } from './lib/licenses.js';

const report = z.record(
  z.string(),
  z.array(z.object({ name: z.string(), versions: z.array(z.string()) }).loose()),
);

const raw = execFileSync('pnpm', ['-r', 'licenses', 'list', '--json'], {
  encoding: 'utf8',
  maxBuffer: 64 << 20,
});
const byLicense = report.parse(JSON.parse(raw));

const violations: string[] = [];
let count = 0;
for (const [license, packages] of Object.entries(byLicense)) {
  for (const pkg of packages) {
    count++;
    if (!isLicenseAllowed(license, pkg.name)) {
      violations.push(`${pkg.name}@${pkg.versions.join(',')}: ${license}`);
    }
  }
}

const systemBinaries = z.object({
  binaries: z.array(
    z
      .object({
        name: z.string(),
        image: z.enum(['app', 'converter']),
        license: z.string(),
        reason: z.string().min(10),
      })
      .strict(),
  ),
});
systemBinaries.parse(JSON.parse(readFileSync(new URL('./system-binaries.json', import.meta.url), 'utf8')));

if (violations.length) {
  console.error(`License check failed (${violations.length}):\n  ${violations.join('\n  ')}`);
  process.exit(1);
}
console.log(`License check passed: ${count} packages.`);
