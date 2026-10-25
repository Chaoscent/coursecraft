// SPDX-License-Identifier: Apache-2.0
import type { MailJob } from '@coursecraft/shared';

/**
 * Plain-text mails in the user's language. No HTML: names and course titles
 * cannot inject markup, and every client shows the text the same way.
 */
type Params = Record<string, string>;
type Template = (p: Params) => { subject: string; text: string };

const footer = {
  de: '\n\n-- \nDiese Nachricht wurde automatisch von Coursecraft versendet.',
  en: '\n\n-- \nThis message was sent automatically by Coursecraft.',
};

const TEMPLATES: Record<'de' | 'en', Record<MailJob['kind'] | 'test', Template>> = {
  de: {
    passwordReset: (p) => ({
      subject: 'Passwort zurücksetzen',
      text: `Hallo ${p['name'] ?? ''},\n\nfür Ihr Konto wurde ein neues Passwort angefordert. Über diesen Link können Sie es in den nächsten ${p['minutes'] ?? '60'} Minuten festlegen:\n\n${p['link'] ?? ''}\n\nWenn Sie das nicht waren, ignorieren Sie diese Nachricht; Ihr Passwort bleibt unverändert.`,
    }),
    assigned: (p) => ({
      subject: `Neuer Kurs: ${p['title'] ?? ''}`,
      text: `Hallo ${p['name'] ?? ''},\n\nIhnen wurde der Kurs „${p['title'] ?? ''}“ zugewiesen.${p['due'] ? ` Bitte schließen Sie ihn bis ${p['due']} ab.` : ''}\n\n${p['link'] ?? ''}`,
    }),
    reminder: (p) => ({
      subject: `Erinnerung: ${p['title'] ?? ''}`,
      text: `Hallo ${p['name'] ?? ''},\n\nder Kurs „${p['title'] ?? ''}“ ist bis ${p['due'] ?? ''} fällig und noch nicht abgeschlossen.\n\n${p['link'] ?? ''}`,
    }),
    pathAssigned: (p) => ({
      subject: `Neuer Lernpfad: ${p['title'] ?? ''}`,
      text: `Hallo ${p['name'] ?? ''},\n\nIhnen wurde der Lernpfad „${p['title'] ?? ''}“ mit ${p['steps'] ?? ''} Kursen zugewiesen.${p['due'] ? ` Bitte schließen Sie ihn bis ${p['due']} ab.` : ''}\n\n${p['link'] ?? ''}`,
    }),
    pathReminder: (p) => ({
      subject: `Erinnerung: ${p['title'] ?? ''}`,
      text: `Hallo ${p['name'] ?? ''},\n\nder Lernpfad „${p['title'] ?? ''}“ ist bis ${p['due'] ?? ''} fällig. Offen sind noch ${p['open'] ?? ''} von ${p['steps'] ?? ''} Kursen.\n\n${p['link'] ?? ''}`,
    }),
    securityAlert: (p) => ({
      subject: 'Sicherheitshinweis zu Ihrem Konto',
      text:
        `Hallo ${p['name'] ?? ''},\n\n` +
        (p['event'] === 'totp_disabled'
          ? 'die Zwei-Faktor-Authentisierung wurde für Ihr Konto deaktiviert und alle anderen Sitzungen wurden beendet.'
          : 'an Ihrem Konto wurde eine sicherheitsrelevante Änderung vorgenommen.') +
        '\n\nWenn Sie das nicht waren, ändern Sie sofort Ihr Passwort und wenden Sie sich an Ihre Administration.',
    }),
    test: () => ({
      subject: 'Coursecraft: Testnachricht',
      text: 'Die E-Mail-Einstellungen funktionieren.',
    }),
  },
  en: {
    passwordReset: (p) => ({
      subject: 'Reset your password',
      text: `Hello ${p['name'] ?? ''},\n\na new password was requested for your account. Use this link within ${p['minutes'] ?? '60'} minutes to set it:\n\n${p['link'] ?? ''}\n\nIf this was not you, ignore this message; your password stays unchanged.`,
    }),
    assigned: (p) => ({
      subject: `New course: ${p['title'] ?? ''}`,
      text: `Hello ${p['name'] ?? ''},\n\nthe course “${p['title'] ?? ''}” was assigned to you.${p['due'] ? ` Please complete it by ${p['due']}.` : ''}\n\n${p['link'] ?? ''}`,
    }),
    reminder: (p) => ({
      subject: `Reminder: ${p['title'] ?? ''}`,
      text: `Hello ${p['name'] ?? ''},\n\nthe course “${p['title'] ?? ''}” is due by ${p['due'] ?? ''} and not completed yet.\n\n${p['link'] ?? ''}`,
    }),
    pathAssigned: (p) => ({
      subject: `New learning path: ${p['title'] ?? ''}`,
      text: `Hello ${p['name'] ?? ''},\n\nthe learning path “${p['title'] ?? ''}” with ${p['steps'] ?? ''} courses was assigned to you.${p['due'] ? ` Please complete it by ${p['due']}.` : ''}\n\n${p['link'] ?? ''}`,
    }),
    pathReminder: (p) => ({
      subject: `Reminder: ${p['title'] ?? ''}`,
      text: `Hello ${p['name'] ?? ''},\n\nthe learning path “${p['title'] ?? ''}” is due by ${p['due'] ?? ''}. ${p['open'] ?? ''} of ${p['steps'] ?? ''} courses are still open.\n\n${p['link'] ?? ''}`,
    }),
    securityAlert: (p) => ({
      subject: 'Security notice for your account',
      text:
        `Hello ${p['name'] ?? ''},\n\n` +
        (p['event'] === 'totp_disabled'
          ? 'two-factor authentication was turned off for your account and all other sessions were ended.'
          : 'a security-relevant change was made to your account.') +
        '\n\nIf this was not you, change your password immediately and contact your administrator.',
    }),
    test: () => ({
      subject: 'Coursecraft: test message',
      text: 'The e-mail settings work.',
    }),
  },
};

/** Line breaks in single-line values would let a value pose as another paragraph or header. */
const oneLine = (params: Params): Params =>
  Object.fromEntries(Object.entries(params).map(([k, v]) => [k, v.replace(/[\r\n]+/g, ' ')]));

export function renderMail(kind: MailJob['kind'] | 'test', locale: 'de' | 'en', params: Params = {}) {
  const mail = TEMPLATES[locale][kind](oneLine(params));
  return { subject: mail.subject, text: mail.text + footer[locale] };
}

export function formatDue(date: Date, locale: 'de' | 'en', timeZone: string): string {
  return new Intl.DateTimeFormat(locale === 'de' ? 'de-DE' : 'en-GB', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone,
  }).format(date);
}
