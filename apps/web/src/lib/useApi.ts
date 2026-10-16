// SPDX-License-Identifier: Apache-2.0
import { useCallback, useEffect, useState } from 'react';
import { errorMessage } from './errors.js';

/**
 * Loads data when the (memoized) fetcher changes; `reload` fetches again.
 * Late responses of superseded requests are ignored.
 */
export function useApi<T>(fetcher: () => Promise<T>): {
  data: T | undefined;
  error: string | null;
  reload: () => void;
} {
  const [state, setState] = useState<{ data: T | undefined; error: string | null }>({
    data: undefined,
    error: null,
  });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let active = true;
    fetcher().then(
      (data) => {
        if (active) setState({ data, error: null });
      },
      (error: unknown) => {
        if (active) setState((s) => ({ data: s.data, error: errorMessage(error) }));
      },
    );
    return () => {
      active = false;
    };
  }, [fetcher, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { data: state.data, error: state.error, reload };
}
