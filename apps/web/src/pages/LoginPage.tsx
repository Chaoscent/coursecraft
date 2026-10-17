// SPDX-License-Identifier: Apache-2.0
import { loginResponseSchema, publicSsoProvidersSchema, SSO_ERRORS } from '@coursecraft/shared';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { api } from '../api/client.js';
import { useSession } from '../api/session.js';
import { Button } from '../components/Button.js';
import { FormGrid, TextField } from '../components/Field.js';
import { Notice } from '../components/Notice.js';
import { AuthFrame } from '../layout/AuthFrame.js';
import { errorMessage } from '../lib/errors.js';
import { useApi } from '../lib/useApi.js';
import styles from './LoginPage.module.css';

export function LoginPage() {
  const { t } = useTranslation();
  const { session, setSession, setupRequired } = useSession();
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const ssoError = SSO_ERRORS.find((e) => e === search.get('sso_error'));
  const providers = useApi(
    useCallback(() => api(publicSsoProvidersSchema, '/api/auth/sso/providers').then((r) => r.items), []),
  ).data;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (setupRequired) return <Navigate to="/setup" replace />;
  if (session) return <Navigate to="/" replace />;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = challenge
        ? await api(loginResponseSchema, '/api/auth/login/totp', {
            method: 'POST',
            body: { challenge, code },
          })
        : await api(loginResponseSchema, '/api/auth/login', { method: 'POST', body: { email, password } });
      if (result.status === 'totp_required') {
        setChallenge(result.challenge);
        setPassword('');
      } else {
        setSession(result.session);
        void navigate('/');
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
        title={t('login.title')}
        footer={
          <>
            {challenge ? null : <Link to="/reset-password">{t('login.forgot')}</Link>}
            <Button type="submit" variant="primary" isDisabled={busy}>
              {challenge ? t('login.verify') : t('login.submit')}
            </Button>
          </>
        }
      >
        {error ? <Notice tone="danger">{error}</Notice> : null}
        {ssoError ? <Notice tone="danger">{t(`login.sso.errors.${ssoError}`)}</Notice> : null}
        <FormGrid>
          {challenge ? (
            <TextField
              label={t('login.code')}
              value={code}
              onChange={setCode}
              autoComplete="one-time-code"
              description={t('login.codeHint')}
              isRequired
              autoFocus
            />
          ) : (
            <>
              <TextField
                label={t('fields.email')}
                type="email"
                value={email}
                onChange={setEmail}
                autoComplete="username"
                isRequired
                autoFocus
              />
              <TextField
                label={t('fields.password')}
                type="password"
                value={password}
                onChange={setPassword}
                autoComplete="current-password"
                isRequired
              />
            </>
          )}
        </FormGrid>
        {!challenge && providers?.length ? (
          <div className={styles.sso}>
            <span className={styles.ssoLabel}>{t('login.sso.or')}</span>
            {providers.map((p) => (
              // A full page navigation: the provider's pages replace ours and send the browser back.
              <a key={p.id} className={styles.ssoLink} href={`/api/auth/sso/${p.id}/start`}>
                {t('login.sso.with', { name: p.name })}
              </a>
            ))}
          </div>
        ) : null}
      </AuthFrame>
    </form>
  );
}
