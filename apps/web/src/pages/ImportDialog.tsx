// SPDX-License-Identifier: Apache-2.0
import {
  conversionResponseSchema,
  okSchema,
  startConversionResponseSchema,
  type ConversionResponse,
} from '@lernwerk/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { api } from '../api/client.js';
import { Button } from '../components/Button.js';
import { Dialog } from '../components/Dialog.js';
import { Notice } from '../components/Notice.js';
import { errorMessage } from '../lib/errors.js';
import styles from './AdminPages.module.css';

const POLL_MS = 1500;

/** Polls a conversion until it is no longer pending. */
export function useConversion(id: string | null): {
  conversion: ConversionResponse | null;
  error: string | null;
} {
  const [conversion, setConversion] = useState<ConversionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!id) return;
    let stopped = false;
    let timer: number | undefined;
    const poll = () => {
      api(conversionResponseSchema, `/api/conversions/${id}`)
        .then((c) => {
          if (stopped) return;
          setConversion(c);
          if (c.status === 'pending') timer = window.setTimeout(poll, POLL_MS);
        })
        .catch((e: unknown) => !stopped && setError(errorMessage(e)));
    };
    poll();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [id]);
  return { conversion, error };
}

/** Starts a presentation import; resolves with the conversion id. */
export async function startImport(file: File, language: string): Promise<string> {
  const form = new FormData();
  form.append('file', file, file.name);
  const r = await api(startConversionResponseSchema, '/api/courses/import', {
    method: 'POST',
    form,
    query: { language },
  });
  return r.conversionId;
}

/** Progress of an import: rendering, warnings, and the way into the new course. */
export function ImportDialog({
  fileName,
  conversionId: id,
  uploadError,
  onClose,
}: {
  fileName: string;
  conversionId: string | null;
  uploadError: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [skipError, setSkipError] = useState<string | null>(null);
  const { conversion, error } = useConversion(id);

  const done = conversion?.status === 'done' && conversion.courseId;
  const problem = uploadError ?? error ?? skipError;
  const step = problem
    ? null
    : !id
      ? t('import.uploading')
      : conversion?.status === 'pending' || !conversion
        ? t('import.rendering')
        : null;

  return (
    <Dialog
      title={t('import.title')}
      isOpen
      onClose={onClose}
      footer={
        <>
          {conversion?.status === 'pending' ? (
            <Button
              onPress={() =>
                void api(okSchema, `/api/conversions/${conversion.id}/skip`, { method: 'POST' }).catch(
                  (e: unknown) => setSkipError(errorMessage(e)),
                )
              }
            >
              {t('import.skip')}
            </Button>
          ) : null}
          <Button onPress={onClose}>{done ? t('common.close') : t('common.cancel')}</Button>
          {done ? (
            <Button variant="primary" onPress={() => void navigate(`/author/courses/${conversion.courseId}`)}>
              {t('import.open')}
            </Button>
          ) : null}
        </>
      }
    >
      <div className={styles.stack}>
        <p>
          <strong>{fileName}</strong>
        </p>
        {problem ? <Notice tone="danger">{problem}</Notice> : null}
        {step ? (
          <p role="status" aria-live="polite">
            {step}
          </p>
        ) : null}
        {done ? (
          <Notice tone={conversion.warnings.length ? 'warning' : 'success'}>{t('import.done')}</Notice>
        ) : null}
        {done && conversion.warnings.length ? (
          <ul aria-label={t('import.warnings')}>
            {conversion.warnings.map((w, i) => (
              <li key={i}>
                {w.slide ? `${t('import.slide', { n: w.slide })}: ` : ''}
                {t(`import.warning.${w.code}`)}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Dialog>
  );
}
