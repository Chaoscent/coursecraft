// SPDX-License-Identifier: Apache-2.0
import { getSessionResponseSchema, type Permission, type SessionInfo } from '@coursecraft/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { i18n } from '../i18n/index.js';
import { api, onUnauthenticated, setCsrfToken } from './client.js';

interface SessionState {
  loading: boolean;
  session: SessionInfo | null;
  setupRequired: boolean;
  setSession: (session: SessionInfo | null) => void;
  refresh: () => Promise<void>;
  can: (permission: Permission) => boolean;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSessionState] = useState<SessionInfo | null>(null);
  const [setupRequired, setSetupRequired] = useState(false);

  const setSession = useCallback((next: SessionInfo | null) => {
    setCsrfToken(next?.csrfToken ?? null);
    setSessionState(next);
    if (next) void i18n.changeLanguage(next.user.locale);
  }, []);

  const refresh = useCallback(async () => {
    const result = await api(getSessionResponseSchema, '/api/session');
    setSetupRequired(result.setupRequired);
    setSession(result.session);
  }, [setSession]);

  useEffect(() => {
    api(getSessionResponseSchema, '/api/session')
      .then((result) => {
        setSetupRequired(result.setupRequired);
        setSession(result.session);
      })
      .catch(() => setSession(null))
      .finally(() => setLoading(false));
    return onUnauthenticated(() => setSession(null));
  }, [setSession]);

  const value = useMemo<SessionState>(
    () => ({
      loading,
      session,
      setupRequired,
      setSession,
      refresh,
      can: (permission) => !!session?.user.permissions.includes(permission),
    }),
    [loading, session, setupRequired, setSession, refresh],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const state = useContext(SessionContext);
  if (!state) throw new Error('useSession outside SessionProvider');
  return state;
}
