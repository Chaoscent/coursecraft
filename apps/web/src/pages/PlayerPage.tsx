// SPDX-License-Identifier: Apache-2.0
import { launchResponseSchema, okSchema, type LaunchResponse } from '@lernwerk/shared';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { api } from '../api/client.js';
import { Button } from '../components/Button.js';
import { Notice } from '../components/Notice.js';
import { errorMessage } from '../lib/errors.js';
import styles from './PlayerPage.module.css';

const HEARTBEAT_MS = 60_000;

/** Messages from the SCORM wrapper on the content origin. */
function isCommit(
  data: unknown,
  launchId: string,
): data is { cmi: Record<string, unknown>; finished: boolean } {
  if (typeof data !== 'object' || data === null) return false;
  const m = data as Record<string, unknown>;
  return (
    m['type'] === 'lw:commit' &&
    m['launchId'] === launchId &&
    typeof m['cmi'] === 'object' &&
    m['cmi'] !== null &&
    !Array.isArray(m['cmi']) &&
    typeof m['finished'] === 'boolean'
  );
}

/**
 * Course playback host: the course runs in a frame on the content origin;
 * this page holds the session, keeps the launch alive and stores SCORM data.
 */
export function PlayerPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id = '' } = useParams();
  const [search] = useSearchParams();
  const newAttempt = search.get('attempt') === 'new';
  const frame = useRef<HTMLIFrameElement>(null);
  const [launch, setLaunch] = useState<LaunchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api(launchResponseSchema, `/api/learn/items/${id}/launch`, { method: 'POST', body: { newAttempt } })
      .then((l) => !cancelled && setLaunch(l))
      .catch((e: unknown) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [id, newAttempt]);

  useEffect(() => {
    if (!launch) return;
    const beat = window.setInterval(() => {
      void api(okSchema, `/api/learn/launches/${launch.launchId}/heartbeat`, { method: 'POST' }).catch(
        () => undefined,
      );
    }, HEARTBEAT_MS);
    const end = () =>
      void api(okSchema, `/api/learn/launches/${launch.launchId}/end`, {
        method: 'POST',
        keepalive: true,
      }).catch(() => undefined);
    window.addEventListener('pagehide', end);

    const onMessage = (event: MessageEvent<unknown>) => {
      if (event.origin !== launch.contentOrigin || event.source !== frame.current?.contentWindow) return;
      const data = event.data as { type?: unknown } | null;
      if (data?.type === 'lw:ready' && launch.scorm && launch.cmi) {
        frame.current?.contentWindow?.postMessage(
          { type: 'lw:init', launchId: launch.launchId, kind: launch.kind, cmi: launch.cmi, ...launch.scorm },
          launch.contentOrigin,
        );
      } else if (isCommit(data, launch.launchId)) {
        api(okSchema, `/api/learn/launches/${launch.launchId}/scorm`, {
          method: 'POST',
          body: { cmi: data.cmi, finished: data.finished },
          keepalive: data.finished,
        })
          .then(() => setSaveError(null))
          .catch((e: unknown) => setSaveError(errorMessage(e)));
      }
    };
    window.addEventListener('message', onMessage);
    return () => {
      window.clearInterval(beat);
      window.removeEventListener('pagehide', end);
      window.removeEventListener('message', onMessage);
      end();
    };
  }, [launch]);

  return (
    <div className={styles.player}>
      <header className={styles.bar}>
        <span className={styles.title}>{launch?.title ?? t('player.loading')}</span>
        {saveError ? (
          <span className={styles.error} role="alert">
            {t('player.saveFailed')}
          </span>
        ) : null}
        <Button icon="x" onPress={() => void navigate('/')}>
          {t('player.close')}
        </Button>
      </header>
      {error ? (
        <div className={styles.message}>
          <Notice tone="danger">{error}</Notice>
        </div>
      ) : launch ? (
        <iframe
          ref={frame}
          className={styles.frame}
          src={launch.url}
          title={launch.title}
          allow="fullscreen; autoplay"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
        />
      ) : null}
    </div>
  );
}
