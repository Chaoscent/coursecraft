// SPDX-License-Identifier: Apache-2.0
import { okSchema, PASSWORD_MIN_LENGTH } from '@coursecraft/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { api } from '../api/client.js';
import { Button } from '../components/Button.js';
import { FormGrid, TextField } from '../components/Field.js';
import { Notice } from '../components/Notice.js';
import { AuthFrame } from '../layout/AuthFrame.js';
import { errorMessage } from '../lib/errors.js';

/** Request a reset link (no token in the address) or set the new password (token in the fragment). */
export function ResetPasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // The token travels in the fragment: it never reaches server logs or other sites through Referer.
  const token = window.location.hash.slice(1);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const mismatch = repeat.length > 0 && repeat !== password;
  const tooShort = password.length > 0 && password.length < PASSWORD_MIN_LENGTH;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (token) {
        await api(okSchema, '/api/auth/password-reset/confirm', {
          method: 'POST',
          body: { token, newPassword: password },
        });
        window.history.replaceState(null, '', window.location.pathname);
        void navigate('/login', { replace: true });
      } else {
        await api(okSchema, '/api/auth/password-reset', { method: 'POST', body: { email } });
        setSent(true);
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!mismatch && !tooShort) void submit();
      }}
    >
      <AuthFrame
        title={token ? t('reset.setTitle') : t('reset.requestTitle')}
        footer={
          <>
            <Link to="/login">{t('reset.backToLogin')}</Link>
            {sent ? null : (
              <Button type="submit" variant="primary" isDisabled={busy}>
                {token ? t('reset.save') : t('reset.send')}
              </Button>
            )}
          </>
        }
      >
        {error ? <Notice tone="danger">{error}</Notice> : null}
        {sent ? <Notice tone="success">{t('reset.sent')}</Notice> : null}
        {sent ? null : (
          <FormGrid>
            {token ? (
              <>
                <TextField
                  label={t('password.new')}
                  type="password"
                  value={password}
                  onChange={setPassword}
                  autoComplete="new-password"
                  isRequired
                  autoFocus
                  errorMessage={
                    tooShort ? t('fields.passwordTooShort', { min: PASSWORD_MIN_LENGTH }) : undefined
                  }
                />
                <TextField
                  label={t('fields.passwordRepeat')}
                  type="password"
                  value={repeat}
                  onChange={setRepeat}
                  autoComplete="new-password"
                  isRequired
                  errorMessage={mismatch ? t('fields.passwordMismatch') : undefined}
                />
              </>
            ) : (
              <TextField
                label={t('fields.email')}
                type="email"
                value={email}
                onChange={setEmail}
                autoComplete="username"
                isRequired
                autoFocus
                description={t('reset.hint')}
              />
            )}
          </FormGrid>
        )}
      </AuthFrame>
    </form>
  );
}
