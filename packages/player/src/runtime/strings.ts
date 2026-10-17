// SPDX-License-Identifier: Apache-2.0
/** Player interface texts; the course language picks the set. */
const STRINGS = {
  de: {
    outline: 'Inhalt',
    previous: 'Zurück',
    next: 'Weiter',
    progress: 'Fortschritt',
    textView: 'Textansicht',
    slideView: 'Folienansicht',
    toggleOutline: 'Inhalt ein-/ausblenden',
    locked: 'Erst die vorherigen Inhalte bearbeiten',
    unsupported: 'Dieser Inhaltstyp wird in dieser Version noch nicht angezeigt.',
    complete: 'Kurs abgeschlossen',
    of: 'von',
    transcript: 'Transkript',
  },
  en: {
    outline: 'Contents',
    previous: 'Back',
    next: 'Next',
    progress: 'Progress',
    textView: 'Text view',
    slideView: 'Slide view',
    toggleOutline: 'Show or hide contents',
    locked: 'Complete the previous content first',
    unsupported: 'This content type is not shown in this version yet.',
    complete: 'Course completed',
    of: 'of',
    transcript: 'Transcript',
  },
} as const;

export type Strings = { readonly [K in keyof (typeof STRINGS)['en']]: string };

export function stringsFor(lang: string): Strings {
  return lang.startsWith('de') ? STRINGS.de : STRINGS.en;
}
