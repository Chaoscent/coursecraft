// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';

// Also set by the packages themselves before their first schema; kept for schemas of the app.
z.config({ jitless: true });
