// SPDX-License-Identifier: Apache-2.0
import { certificateVerificationSchema } from '@coursecraft/shared';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import type { z } from 'zod';
import { api, ApiError } from '../api/client.js';
import { Button } from '../components/Button.js';
import { FormGrid, FormRow, TextField } from '../components/Field.js';
import { Notice } from '../components/Notice.js';
import { AuthFrame } from '../layout/AuthFrame.js';
import { errorMessage } from '../lib/errors.js';
import { formatDateTime } from '../lib/format.js';
import { useApi } from '../lib/useApi.js';

type Result = z.infer<typeof certificateVerificationSchema>;

/** Public: anyone holding a certificate number can confirm it (printed on every certificate). */
export function VerifyPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const params = useParams();
  const [serial, setSerial] = useState(params['serial'] ?? '');
  const wanted = params['serial'];
  const fetcher = useCallback(async (): Promise<{ result: Result } | { failed: string } | null> => {
    if (!wanted) return null;
    try {
      return {
        result: await api(
          certificateVerificationSchema,
          `/api/certificates/verify/${encodeURIComponent(wanted)}`,
        ),
      };
    } catch (e) {
      return {
        failed:
          e instanceof ApiError && (e.status === 404 || e.status === 400)
            ? t('verify.notFound')
            : errorMessage(e),
      };
    }
  }, [wanted, t]);
  const { data } = useApi(fetcher);
  const result = data && 'result' in data ? data.result : null;
  const error = data && 'failed' in data ? data.failed : null;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void navigate(`/verify/${encodeURIComponent(serial.trim().toUpperCase())}`);
      }}
    >
      <AuthFrame
        title={t('verify.title')}
        footer={
          <>
            <Link to="/login">{t('verify.signIn')}</Link>
            <Button type="submit" variant="primary">
              {t('verify.check')}
            </Button>
          </>
        }
      >
        <Notice tone="info">{t('verify.hint')}</Notice>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        {result ? <Notice tone="success">{t('verify.valid')}</Notice> : null}
        <FormGrid>
          <TextField
            label={t('verify.serial')}
            value={serial}
            onChange={setSerial}
            isRequired
            autoFocus
            description="CC-XXXX-XXXX-XXXX"
          />
          {result ? (
            <>
              <FormRow label={t('verify.learner')}>{result.learnerName}</FormRow>
              <FormRow label={t('verify.course')}>{result.itemTitle}</FormRow>
              <FormRow label={t('verify.completed')}>{formatDateTime(result.completedAt)}</FormRow>
              <FormRow label={t('verify.issued')}>{formatDateTime(result.issuedAt)}</FormRow>
            </>
          ) : null}
        </FormGrid>
      </AuthFrame>
    </form>
  );
}
