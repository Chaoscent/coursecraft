// SPDX-License-Identifier: Apache-2.0
import { SMTP_SECURITY, smtpSettingsSchema, okSchema, type SmtpSettings } from '@coursecraft/shared';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client.js';
import { Button } from '../components/Button.js';
import { Checkbox, FormGrid, FormRow, SelectField, TextField } from '../components/Field.js';
import { Notice } from '../components/Notice.js';
import { Page, PageBody, Section } from '../components/Page.js';
import { errorMessage } from '../lib/errors.js';
import { useApi } from '../lib/useApi.js';

const DEFAULT_PORT = { tls: 465, starttls: 587, none: 25 } as const;

function Form({ settings, onSaved }: { settings: SmtpSettings; onSaved: (s: SmtpSettings) => void }) {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(settings.enabled);
  const [host, setHost] = useState(settings.host);
  const [port, setPort] = useState(String(settings.port));
  const [security, setSecurity] = useState(settings.security);
  const [username, setUsername] = useState(settings.username);
  const [password, setPassword] = useState('');
  const [removePassword, setRemovePassword] = useState(false);
  const [from, setFrom] = useState(settings.from);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  const save = async () => {
    try {
      const saved = await api(smtpSettingsSchema, '/api/settings/smtp', {
        method: 'PUT',
        body: {
          enabled,
          host,
          port: Number(port),
          security,
          username,
          from,
          ...(removePassword ? { password: null } : password ? { password } : {}),
        },
      });
      setPassword('');
      setRemovePassword(false);
      onSaved(saved);
      setMessage({ tone: 'success', text: t('mail.saved') });
    } catch (e) {
      setMessage({ tone: 'danger', text: errorMessage(e) });
    }
  };
  const test = async () => {
    try {
      await api(okSchema, '/api/settings/smtp/test', { method: 'POST' });
      setMessage({ tone: 'success', text: t('mail.testSent') });
    } catch (e) {
      setMessage({ tone: 'danger', text: errorMessage(e) });
    }
  };

  return (
    <Section title={t('mail.title')}>
      <p>{t('mail.intro')}</p>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <FormGrid wide>
        <FormRow label="">
          <Checkbox isSelected={enabled} onChange={setEnabled}>
            {t('mail.enabled')}
          </Checkbox>
        </FormRow>
        <TextField label={t('mail.host')} value={host} onChange={setHost} isRequired />
        <SelectField
          label={t('mail.security')}
          value={security}
          onChange={(v) => {
            setSecurity(v);
            setPort(String(DEFAULT_PORT[v]));
          }}
          options={SMTP_SECURITY.map((s) => ({ id: s, label: t(`mail.securityKinds.${s}`) }))}
        />
        <TextField label={t('mail.port')} value={port} onChange={setPort} isRequired />
        <TextField label={t('mail.username')} value={username} onChange={setUsername} autoComplete="off" />
        <TextField
          label={t('mail.password')}
          type="password"
          autoComplete="off"
          value={password}
          onChange={setPassword}
          isDisabled={removePassword}
          {...(settings.password.set ? { description: t('mail.passwordStored') } : {})}
        />
        {settings.password.set ? (
          <FormRow label="">
            <Checkbox isSelected={removePassword} onChange={setRemovePassword}>
              {t('mail.removePassword')}
            </Checkbox>
          </FormRow>
        ) : null}
        <TextField
          label={t('mail.from')}
          value={from}
          onChange={setFrom}
          isRequired
          description={t('mail.fromHint')}
        />
        <FormRow label="">
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <Button variant="primary" onPress={() => void save()}>
              {t('common.save')}
            </Button>
            <Button isDisabled={!settings.enabled} onPress={() => void test()}>
              {t('mail.test')}
            </Button>
          </div>
        </FormRow>
      </FormGrid>
      {security === 'none' ? <Notice tone="warning">{t('mail.noTls')}</Notice> : null}
    </Section>
  );
}

/** SMTP settings. Mail is the only other outbound connection besides the optional AI adapter. */
export function MailPage() {
  const { t } = useTranslation();
  const fetcher = useCallback(() => api(smtpSettingsSchema, '/api/settings/smtp'), []);
  const { data, error } = useApi(fetcher);
  const [saved, setSaved] = useState<SmtpSettings | null>(null);
  const current = saved ?? data;
  return (
    <Page title={t('mail.page')}>
      <PageBody>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        {current ? <Form key={current.updatedAt ?? 'new'} settings={current} onSaved={setSaved} /> : null}
      </PageBody>
    </Page>
  );
}
