// SPDX-License-Identifier: Apache-2.0
import { loginResponseSchema, PASSWORD_MIN_LENGTH, type Locale } from '@coursecraft/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate } from 'react-router';
import { api } from '../api/client.js';
import { useSession } from '../api/session.js';
import { Button } from '../components/Button.js';
import { FormGrid, SelectField, TextField } from '../components/Field.js';
import { Notice } from '../components/Notice.js';
import { AuthFrame } from '../layout/AuthFrame.js';
import { errorMessage } from '../lib/errors.js';

export function SetupPage() {
  const { t, i18n } = useTranslation();
  const { setupRequired, setSession, refresh } = useSession();
  const navigate = useNavigate();
  const [token, setToken] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [locale, setLocale] = useState<Locale>(i18n.language === 'en' ? 'en' : 'de');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!setupRequired) return <Navigate to="/login" replace />;

  const tooShort = password.length > 0 && password.length < PASSWORD_MIN_LENGTH;
  const mismatch = repeat.length > 0 && repeat !== password;

  const submit = async () => {
    if (tooShort || mismatch || !password) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api(loginResponseSchema, '/api/setup', {
        method: 'POST',
        body: { token: token.trim(), email, displayName, password, locale },
      });
      if (result.status === 'ok') {
        setSession(result.session);
        await refresh();
        void navigate('/admin/users');
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
        void submit();
      }}
    >
      <AuthFrame
        title={t('setup.title')}
        footer={
          <Button type="submit" variant="primary" isDisabled={busy}>
            {t('setup.submit')}
          </Button>
        }
      >
        <Notice>{t('setup.intro')}</Notice>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <FormGrid>
          <TextField
            label={t('setup.token')}
            value={token}
            onChange={setToken}
            description={t('setup.tokenHint')}
            isRequired
            autoFocus
          />
          <TextField
            label={t('fields.displayName')}
            value={displayName}
            onChange={setDisplayName}
            autoComplete="name"
            isRequired
          />
          <TextField
            label={t('fields.email')}
            type="email"
            value={email}
            onChange={setEmail}
            autoComplete="email"
            isRequired
          />
          <TextField
            label={t('fields.password')}
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            description={t('fields.passwordHint', { min: PASSWORD_MIN_LENGTH })}
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
          <SelectField
            label={t('fields.language')}
            value={locale}
            onChange={(value) => {
              setLocale(value);
              void i18n.changeLanguage(value);
            }}
            options={[
              { id: 'de', label: 'Deutsch' },
              { id: 'en', label: 'English' },
            ]}
          />
        </FormGrid>
      </AuthFrame>
    </form>
  );
}
