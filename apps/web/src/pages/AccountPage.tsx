// SPDX-License-Identifier: Apache-2.0
import {
  accountSessionsResponseSchema,
  PASSWORD_MIN_LENGTH,
  sessionResponseSchema,
  totpSetupResponseSchema,
  type Locale,
} from '@lernwerk/shared';
import QRCode from 'qrcode';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { api, download } from '../api/client.js';
import { useSession } from '../api/session.js';
import { Badge } from '../components/Badge.js';
import { Button } from '../components/Button.js';
import { DataTable } from '../components/DataTable.js';
import { FormGrid, FormRow, SelectField, TextField } from '../components/Field.js';
import { Notice } from '../components/Notice.js';
import { Page, PageBody, Section } from '../components/Page.js';
import { errorMessage } from '../lib/errors.js';
import { formatDateTime } from '../lib/format.js';
import { useApi } from '../lib/useApi.js';
import styles from './AccountPage.module.css';

type Sessions = z.infer<typeof accountSessionsResponseSchema>['items'];

function Profile() {
  const { t, i18n } = useTranslation();
  const { session, setSession } = useSession();
  const [name, setName] = useState(session?.user.displayName ?? '');
  const [locale, setLocale] = useState<Locale>(session?.user.locale ?? 'de');
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  const save = async () => {
    try {
      const result = await api(sessionResponseSchema, '/api/account', {
        method: 'PATCH',
        body: { displayName: name, locale },
      });
      setSession(result.session);
      await i18n.changeLanguage(locale);
      setMessage({ tone: 'success', text: t('account.saved') });
    } catch (e) {
      setMessage({ tone: 'danger', text: errorMessage(e) });
    }
  };

  return (
    <Section title={t('account.profile')}>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <FormGrid>
        <FormRow label={t('fields.email')}>
          <span>{session?.user.email}</span>
        </FormRow>
        <TextField label={t('fields.displayName')} value={name} onChange={setName} />
        <SelectField
          label={t('fields.language')}
          value={locale}
          onChange={setLocale}
          options={[
            { id: 'de', label: 'Deutsch' },
            { id: 'en', label: 'English' },
          ]}
        />
        <FormRow label="">
          <div>
            <Button onPress={() => void save()}>{t('common.save')}</Button>
          </div>
        </FormRow>
      </FormGrid>
    </Section>
  );
}

function PasswordChange({ onChanged }: { onChanged: () => void }) {
  const { t } = useTranslation();
  const { setSession } = useSession();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const tooShort = next.length > 0 && next.length < PASSWORD_MIN_LENGTH;

  const save = async () => {
    if (tooShort) return;
    try {
      const result = await api(sessionResponseSchema, '/api/account/password', {
        method: 'POST',
        body: { currentPassword: current, newPassword: next },
      });
      setSession(result.session);
      setCurrent('');
      setNext('');
      setMessage({ tone: 'success', text: t('password.changed') });
      onChanged();
    } catch (e) {
      setMessage({ tone: 'danger', text: errorMessage(e) });
    }
  };

  return (
    <Section title={t('password.title')}>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <FormGrid>
        <TextField
          label={t('password.current')}
          type="password"
          value={current}
          onChange={setCurrent}
          autoComplete="current-password"
        />
        <TextField
          label={t('password.new')}
          type="password"
          value={next}
          onChange={setNext}
          autoComplete="new-password"
          description={t('password.endsOtherSessions')}
          errorMessage={tooShort ? t('fields.passwordTooShort', { min: PASSWORD_MIN_LENGTH }) : undefined}
        />
        <FormRow label="">
          <div>
            <Button onPress={() => void save()} isDisabled={!current || !next}>
              {t('password.save')}
            </Button>
          </div>
        </FormRow>
      </FormGrid>
    </Section>
  );
}

function TwoFactor() {
  const { t } = useTranslation();
  const { session, setSession } = useSession();
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const enabled = session?.user.totpEnabled ?? false;

  const start = async () => {
    try {
      const result = await api(totpSetupResponseSchema, '/api/account/totp/setup', { method: 'POST' });
      setSetup({ secret: result.secret, qr: await QRCode.toDataURL(result.uri, { margin: 1, width: 180 }) });
    } catch (e) {
      setMessage({ tone: 'danger', text: errorMessage(e) });
    }
  };
  const confirm = async () => {
    try {
      const result = await api(sessionResponseSchema, '/api/account/totp/confirm', {
        method: 'POST',
        body: { code },
      });
      setSession(result.session);
      setSetup(null);
      setCode('');
      setMessage({ tone: 'success', text: t('totp.enabled') });
    } catch (e) {
      setMessage({ tone: 'danger', text: errorMessage(e) });
    }
  };
  const disable = async () => {
    try {
      const result = await api(sessionResponseSchema, '/api/account/totp/disable', {
        method: 'POST',
        body: { password },
      });
      setSession(result.session);
      setPassword('');
      setMessage({ tone: 'success', text: t('totp.disabled') });
    } catch (e) {
      setMessage({ tone: 'danger', text: errorMessage(e) });
    }
  };

  return (
    <Section title={t('totp.title')}>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <FormGrid>
        <FormRow label={t('totp.status')}>
          <span>
            {enabled ? <Badge tone="success">{t('totp.on')}</Badge> : <Badge>{t('totp.off')}</Badge>}
          </span>
        </FormRow>
        {enabled ? (
          <>
            <TextField
              label={t('fields.password')}
              type="password"
              value={password}
              onChange={setPassword}
              autoComplete="current-password"
            />
            <FormRow label="">
              <div>
                <Button variant="danger" onPress={() => void disable()} isDisabled={!password}>
                  {t('totp.disable')}
                </Button>
              </div>
            </FormRow>
          </>
        ) : setup ? (
          <>
            <FormRow label={t('totp.scan')}>
              <div className={styles.qr}>
                <img src={setup.qr} alt={t('totp.qrAlt')} width={180} height={180} />
                <code className={styles.secret}>{setup.secret}</code>
              </div>
            </FormRow>
            <TextField label={t('login.code')} value={code} onChange={setCode} autoComplete="one-time-code" />
            <FormRow label="">
              <div>
                <Button variant="primary" onPress={() => void confirm()} isDisabled={code.length !== 6}>
                  {t('totp.confirm')}
                </Button>
              </div>
            </FormRow>
          </>
        ) : (
          <FormRow label="">
            <div>
              <Button onPress={() => void start()}>{t('totp.setup')}</Button>
            </div>
          </FormRow>
        )}
      </FormGrid>
    </Section>
  );
}

function SessionList({ reloadKey }: { reloadKey: number }) {
  const { t } = useTranslation();
  const fetcher = useCallback(
    () =>
      api(accountSessionsResponseSchema, '/api/account/sessions').then((r) => ({
        items: r.items,
        reloadKey,
      })),
    [reloadKey],
  );
  const { data, error, reload } = useApi(fetcher);
  const items: Sessions = data?.items ?? [];

  const end = async (id: string) => {
    await api(z.object({ ok: z.literal(true) }), `/api/account/sessions/${id}`, { method: 'DELETE' });
    reload();
  };
  const endOthers = async () => {
    await api(z.object({ ended: z.number() }), '/api/account/sessions/end-others', { method: 'POST' });
    reload();
  };

  return (
    <Section title={t('sessions.title')}>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <div className={styles.sessions}>
        <DataTable
          label={t('sessions.title')}
          rows={items}
          empty={t('sessions.empty')}
          columns={[
            {
              id: 'agent',
              label: t('sessions.device'),
              isRowHeader: true,
              render: (s) => <span className={styles.agent}>{s.userAgent ?? '–'}</span>,
            },
            { id: 'created', label: t('sessions.created'), render: (s) => formatDateTime(s.createdAt) },
            { id: 'seen', label: t('sessions.lastSeen'), render: (s) => formatDateTime(s.lastSeenAt) },
            {
              id: 'action',
              label: '',
              render: (s) =>
                s.current ? (
                  <Badge>{t('sessions.current')}</Badge>
                ) : (
                  <Button onPress={() => void end(s.id)}>{t('sessions.end')}</Button>
                ),
            },
          ]}
        />
      </div>
      <div>
        <Button onPress={() => void endOthers()} isDisabled={items.length < 2}>
          {t('sessions.endOthers')}
        </Button>
      </div>
    </Section>
  );
}

function DataExport() {
  const { t } = useTranslation();
  return (
    <Section title={t('privacy.title')}>
      <p>{t('privacy.exportHint')}</p>
      <div>
        <Button
          icon="download"
          onPress={() => void download('/api/account/export', 'lernwerk-personal-data.json')}
        >
          {t('privacy.export')}
        </Button>
      </div>
    </Section>
  );
}

export function AccountPage() {
  const { t } = useTranslation();
  const [reloadKey, setReloadKey] = useState(0);
  return (
    <Page title={t('account.title')}>
      <PageBody>
        <Profile />
        <PasswordChange onChanged={() => setReloadKey((k) => k + 1)} />
        <TwoFactor />
        <SessionList reloadKey={reloadKey} />
        <DataExport />
      </PageBody>
    </Page>
  );
}
