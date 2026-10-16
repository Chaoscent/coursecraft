// SPDX-License-Identifier: Apache-2.0
import { PASSWORD_MIN_LENGTH, sessionResponseSchema } from '@lernwerk/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client.js';
import { useSession } from '../api/session.js';
import { Button } from '../components/Button.js';
import { FormGrid, TextField } from '../components/Field.js';
import { Notice } from '../components/Notice.js';
import { AuthFrame } from '../layout/AuthFrame.js';
import { errorMessage } from '../lib/errors.js';

/** Shown instead of the application while an initial or reset password must be replaced. */
export function ChangePasswordPage() {
  const { t } = useTranslation();
  const { setSession } = useSession();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);

  const tooShort = next.length > 0 && next.length < PASSWORD_MIN_LENGTH;
  const mismatch = repeat.length > 0 && repeat !== next;

  const submit = async () => {
    if (tooShort || mismatch) return;
    setError(null);
    try {
      const result = await api(sessionResponseSchema, '/api/account/password', {
        method: 'POST',
        body: { currentPassword: current, newPassword: next },
      });
      setSession(result.session);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <AuthFrame
        title={t('password.forcedTitle')}
        footer={
          <Button type="submit" variant="primary">
            {t('password.save')}
          </Button>
        }
      >
        <Notice tone="warning">{t('password.forcedIntro')}</Notice>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <FormGrid>
          <TextField
            label={t('password.current')}
            type="password"
            value={current}
            onChange={setCurrent}
            autoComplete="current-password"
            isRequired
            autoFocus
          />
          <TextField
            label={t('password.new')}
            type="password"
            value={next}
            onChange={setNext}
            autoComplete="new-password"
            errorMessage={tooShort ? t('fields.passwordTooShort', { min: PASSWORD_MIN_LENGTH }) : undefined}
            isRequired
          />
          <TextField
            label={t('fields.passwordRepeat')}
            type="password"
            value={repeat}
            onChange={setRepeat}
            autoComplete="new-password"
            errorMessage={mismatch ? t('fields.passwordMismatch') : undefined}
            isRequired
          />
        </FormGrid>
      </AuthFrame>
    </form>
  );
}
