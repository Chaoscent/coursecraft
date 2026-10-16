// SPDX-License-Identifier: Apache-2.0
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import de from './de.json';
import en from './en.json';

function initialLanguage(): 'de' | 'en' {
  return navigator.language.toLowerCase().startsWith('de') ? 'de' : 'en';
}

export const i18n = i18next;

void i18next.use(initReactI18next).init({
  resources: { de: { translation: de }, en: { translation: en } },
  lng: initialLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

i18next.on('languageChanged', (lng) => {
  document.documentElement.lang = lng;
});
document.documentElement.lang = i18next.language;
