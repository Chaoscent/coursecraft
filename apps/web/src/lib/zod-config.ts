// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';

// Zod would probe `new Function` for faster parsing; the CSP forbids eval.
z.config({ jitless: true });
