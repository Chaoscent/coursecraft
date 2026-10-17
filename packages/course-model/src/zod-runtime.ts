// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';

// Browsers run under a CSP without eval. Zod would probe `new Function` to build faster
// parsers, which the browser reports as a violation. This module is imported first by the
// package entry, so it runs before the first schema is created (Zod reads the setting then).
if ('document' in globalThis) z.config({ jitless: true });
