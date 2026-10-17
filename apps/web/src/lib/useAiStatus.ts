// SPDX-License-Identifier: Apache-2.0
import { aiStatusSchema, type AiStatus } from '@lernwerk/shared';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useSession } from '../api/session.js';

/** AI availability for the current user; null while unknown or without permission. */
export function useAiStatus(): { status: AiStatus | null; reload: () => void } {
  const { can } = useSession();
  const allowed = can('ai.use');
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    api(aiStatusSchema, '/api/ai/status')
      .then((s) => !cancelled && setStatus(s))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [allowed, version]);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { status: allowed ? status : null, reload };
}
