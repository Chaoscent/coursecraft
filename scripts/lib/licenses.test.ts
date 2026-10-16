// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { isLicenseAllowed } from './licenses.js';

describe('isLicenseAllowed', () => {
  it.each(['MIT', 'Apache-2.0', '(MIT OR CC0-1.0)', 'MIT AND ISC', 'GPL-3.0 OR MIT'])('allows %s', (l) => {
    expect(isLicenseAllowed(l, 'x')).toBe(true);
  });

  it.each([
    'GPL-3.0',
    'AGPL-3.0-only',
    'LGPL-2.1-or-later',
    'SSPL-1.0',
    'BUSL-1.1',
    'UNLICENSED',
    'Unknown',
    'MIT AND GPL-2.0',
    '(MIT OR (GPL-2.0 AND BSD-3-Clause))',
    'SEE LICENSE IN LICENSE.txt',
  ])('rejects %s', (l) => {
    expect(isLicenseAllowed(l, 'x')).toBe(false);
  });

  it('allows OFL only for the bundled fonts', () => {
    expect(isLicenseAllowed('OFL-1.1', '@ibm/plex-sans')).toBe(true);
    expect(isLicenseAllowed('OFL-1.1', 'some-other-package')).toBe(false);
  });
});
