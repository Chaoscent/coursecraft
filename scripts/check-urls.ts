// SPDX-License-Identifier: Apache-2.0
/**
 * Scans built bundles for absolute URLs. Anything outside the allowlist could
 * be an external request (CDN, font, analytics) and fails the build.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const BUNDLE_DIRS = ['apps/server/dist', 'apps/converter/dist', 'apps/web/dist', 'packages/player/dist'];
const SCANNED = /\.(js|mjs|css|html|json|svg)$/;

/** Identifiers that look like URLs but are never fetched. */
const ALLOWED = [
  /^http:\/\/127\.0\.0\.1[:/]/,
  /^http:\/\/localhost([:/]|$)/,
  // URL parsing helpers (IPv6 host templates) and JSON Schema identifiers.
  /^http:\/\/\[\$\{/,
  /^https?:\/\/json-schema\.org\//,
  // Documentation links inside library error messages; shown as text, never requested.
  /^https:\/\/react\.dev\/errors\//,
  /^https:\/\/reactrouter\.com\//,
  /^https:\/\/react\.i18next\.com\//,
  /^https?:\/\/www\.w3\.org\//,
  /^https:\/\/lernwerk\.invalid\//,
  /^http:\/\/www\.imsglobal\.org\/xsd\//,
  /^http:\/\/www\.imsproject\.org\/xsd\//,
  /^http:\/\/www\.adlnet\.org\/xsd\//,
  /^http:\/\/ltsc\.ieee\.org\/xsd\//,
  /^http:\/\/adlnet\.gov\/expapi\//,
  /^https:\/\/w3id\.org\/xapi\//,
  /^http:\/\/purl\.imsglobal\.org\//,
  /^urn:/,
];

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (SCANNED.test(path) && !path.endsWith('.map')) yield path;
  }
}

const hits: string[] = [];
for (const dir of BUNDLE_DIRS.filter((d) => existsSync(d))) {
  for (const file of walk(dir)) {
    for (const match of readFileSync(file, 'utf8').matchAll(/https?:\/\/[^\s"'`)<>\\]+/g)) {
      if (!ALLOWED.some((re) => re.test(match[0]))) hits.push(`${file}: ${match[0]}`);
    }
  }
}

if (hits.length) {
  console.error(`Absolute URLs outside the allowlist:\n  ${[...new Set(hits)].join('\n  ')}`);
  process.exit(1);
}
console.log('URL check passed.');
