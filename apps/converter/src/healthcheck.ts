// SPDX-License-Identifier: Apache-2.0
import { isAlive } from './heartbeat.js';

process.exit(isAlive(process.env['LERNWERK_HEARTBEAT_FILE'] ?? '/tmp/converter-heartbeat') ? 0 : 1);
