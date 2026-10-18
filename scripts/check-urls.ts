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
  /^https:\/\/github\.com\/ungap\/url-search-params\.?$/,
  /^https:\/\/react\.i18next\.com\//,
  /^https:\/\/prosemirror\.net\/docs\//,
  /^https:\/\/bit\.ly\/3cXEKWf$/,
  // Placeholder text in the UI ("https://… or mailto:…").
  /^https:\/\/…$/,
  // Example base URLs in the AI provider form hints; shown as text, never requested.
  /^https:\/\/api\.anthropic\.com$/,
  /^https:\/\/api\.openai\.com\/v1$/,
  /^http:\/\/ollama:11434\/v1$/,
  // Example addresses in the operator console hints (reserved example.com domain).
  /^https:\/\/[a-z]+\.(courses|content)\.example\.com$/,
  /^https?:\/\/www\.w3\.org\//,
  // XML namespaces of presentation files (OOXML, Dublin Core); identifiers, never requested.
  /^http:\/\/schemas\.openxmlformats\.org\//,
  /^http:\/\/schemas\.microsoft\.com\/office\/powerpoint\/2010\/main$/,
  /^http:\/\/purl\.org\/dc\/elements\/1\.1\/$/,
  /^https:\/\/coursecraft\.invalid\//,
  /^http:\/\/www\.imsglobal\.org\/xsd\//,
  /^http:\/\/www\.imsproject\.org\/xsd\//,
  /^http:\/\/www\.adlnet\.org\/xsd\//,
  /^http:\/\/ltsc\.ieee\.org\/xsd\//,
  /^http:\/\/adlnet\.gov\/expapi\//,
  /^https:\/\/w3id\.org\/xapi\//,
  // SAML attribute names (claim identifiers matched against assertions, never requested).
  /^http:\/\/schemas\.xmlsoap\.org\/ws\/2005\/05\/identity\/claims\//,
  /^http:\/\/schemas\.microsoft\.com\/ws\/2008\/06\/identity\/claims\//,
  /^http:\/\/purl\.imsglobal\.org\//,
  // Stripe's API (only with COURSECRAFT_STRIPE_SECRET_KEY, operator console).
  /^https:\/\/api\.stripe\.com$/,
  /^http:\/\/projecttincan\.com\/tincan\.xsd$/,
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
