// SPDX-License-Identifier: Apache-2.0
import type { Certificate } from '@coursecraft/shared';
import { randomBytes } from 'node:crypto';
import type { AppContext, AuthState } from '../../http/context.js';
import { AppError, notFound } from '../../http/errors.js';
import { renderPdf, textWidth, type PdfText } from './pdf.js';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** `CC-XXXX-XXXX-XXXX`: 60 random bits without look-alike characters. */
export function newSerial(): string {
  const bytes = randomBytes(12);
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]);
  return `CC-${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8, 12).join('')}`;
}

const toCertificate = (r: {
  id: string;
  serial: string;
  item_title: string;
  completed_at: Date;
  issued_at: Date;
}): Certificate => ({
  id: r.id,
  serial: r.serial,
  itemTitle: r.item_title,
  completedAt: r.completed_at.toISOString(),
  issuedAt: r.issued_at.toISOString(),
});

/**
 * Issues (or returns) the certificate for a learner's passed or completed
 * attempt of an item assigned to them. One certificate per attempt.
 */
export async function issueCertificate(
  ctx: AppContext,
  auth: AuthState,
  itemId: string,
): Promise<Certificate> {
  const registrations = await ctx.db
    .selectFrom('registrations')
    .innerJoin('library_items', 'library_items.id', 'registrations.library_item_id')
    .select([
      'registrations.id',
      'registrations.score_scaled',
      'registrations.completed_at',
      'registrations.success',
      'registrations.completion',
      'library_items.title',
    ])
    .where('registrations.user_id', '=', auth.userId)
    .where('registrations.library_item_id', '=', itemId)
    .where('registrations.success', '!=', 'failed')
    .where((eb) =>
      eb.or([eb('registrations.success', '=', 'passed'), eb('registrations.completion', '=', 'completed')]),
    )
    .orderBy('registrations.attempt', 'desc')
    .limit(1)
    .execute();
  const reg = registrations[0];
  if (!reg) throw new AppError('forbidden', 'The course is not completed yet');
  const existing = await ctx.db
    .selectFrom('certificates')
    .selectAll()
    .where('registration_id', '=', reg.id)
    .executeTakeFirst();
  if (existing) return toCertificate(existing);
  const row = await ctx.db
    .insertInto('certificates')
    .values({
      serial: newSerial(),
      user_id: auth.userId,
      registration_id: reg.id,
      library_item_id: itemId,
      learner_name: auth.displayName,
      item_title: reg.title,
      score_scaled: reg.score_scaled,
      completed_at: reg.completed_at ?? new Date(),
    })
    .onConflict((oc) => oc.column('registration_id').doNothing())
    .returningAll()
    .executeTakeFirst();
  const created =
    row ??
    (await ctx.db
      .selectFrom('certificates')
      .selectAll()
      .where('registration_id', '=', reg.id)
      .executeTakeFirstOrThrow());
  if (row) {
    await ctx.audit.record({
      actorUserId: auth.userId,
      action: 'certificate.issued',
      targetType: 'certificate',
      targetId: created.id,
      meta: { serial: created.serial },
    });
  }
  return toCertificate(created);
}

export async function myCertificates(ctx: AppContext, auth: AuthState): Promise<Certificate[]> {
  const rows = await ctx.db
    .selectFrom('certificates')
    .selectAll()
    .where('user_id', '=', auth.userId)
    .orderBy('issued_at', 'desc')
    .execute();
  return rows.map(toCertificate);
}

const TEXT = {
  de: {
    title: 'Zertifikat',
    confirm: 'Hiermit wird bestätigt, dass',
    course: 'den Kurs',
    done: 'erfolgreich abgeschlossen hat.',
    date: 'Abgeschlossen am',
    score: 'Ergebnis',
    serial: 'Zertifikatsnummer',
    locale: 'de-DE',
  },
  en: {
    title: 'Certificate',
    confirm: 'This is to certify that',
    course: 'has successfully completed the course',
    done: '',
    date: 'Completed on',
    score: 'Result',
    serial: 'Certificate number',
    locale: 'en-GB',
  },
} as const;

/** Shrinks a line until it fits the printable width; very long titles are cut. */
function fitted(text: string, size: number, bold: boolean, maxWidth: number): { text: string; size: number } {
  let s = size;
  while (s > 12 && textWidth(text, s, bold) > maxWidth) s -= 1;
  let t = text;
  while (t.length > 3 && textWidth(t, s, bold) > maxWidth) t = `${t.slice(0, -2).trimEnd()}…`;
  return { text: t, size: s };
}

export async function certificatePdf(
  ctx: AppContext,
  auth: AuthState,
  id: string,
): Promise<{ pdf: Buffer; serial: string }> {
  const row = await ctx.db.selectFrom('certificates').selectAll().where('id', '=', id).executeTakeFirst();
  // Other people's certificates look as if they did not exist, unless the viewer may read reports.
  if (!row || (row.user_id !== auth.userId && !auth.permissions.includes('reports.read')))
    throw notFound('Certificate not found');
  const owner = await ctx.db
    .selectFrom('users')
    .select('locale')
    .where('id', '=', row.user_id)
    .executeTakeFirst();
  const t = TEXT[owner?.locale ?? 'de'];
  const W = 842;
  const H = 595;
  const accent: [number, number, number] = [0.12, 0.37, 0.65];
  const grey: [number, number, number] = [0.35, 0.37, 0.4];
  const date = new Intl.DateTimeFormat(t.locale, { dateStyle: 'long', timeZone: ctx.config.timeZone }).format(
    row.completed_at,
  );
  const name = fitted(row.learner_name, 32, true, 640);
  const course = fitted(row.item_title, 24, true, 700);
  const texts: PdfText[] = [
    { text: t.title.toUpperCase(), size: 40, bold: true, y: 470, color: accent },
    { text: t.confirm, size: 16, y: 410, color: grey },
    { text: name.text, size: name.size, bold: true, y: 360 },
    { text: t.course, size: 16, y: 315, color: grey },
    { text: course.text, size: course.size, bold: true, y: 270 },
    ...(t.done ? [{ text: t.done, size: 16, y: 225, color: grey }] : []),
    { text: `${t.date} ${date}`, size: 14, y: 165 },
    ...(row.score_scaled !== null
      ? [{ text: `${t.score}: ${Math.round(row.score_scaled * 100)} %`, size: 14, y: 140 }]
      : []),
    { text: `${t.serial}: ${row.serial}`, size: 10, y: 60, color: grey },
  ];
  const pdf = renderPdf({
    width: W,
    height: H,
    title: `${t.title} – ${row.item_title}`,
    texts,
    lines: [
      { x1: 30, y1: 30, x2: W - 30, y2: 30, width: 3, color: accent },
      { x1: W - 30, y1: 30, x2: W - 30, y2: H - 30, width: 3, color: accent },
      { x1: W - 30, y1: H - 30, x2: 30, y2: H - 30, width: 3, color: accent },
      { x1: 30, y1: H - 30, x2: 30, y2: 30, width: 3, color: accent },
      { x1: 300, y1: 445, x2: W - 300, y2: 445, width: 1, color: accent },
    ],
  });
  return { pdf, serial: row.serial };
}
