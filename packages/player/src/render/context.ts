// SPDX-License-Identifier: Apache-2.0
import type { Course } from '@coursecraft/course-model';

export interface RenderContext {
  /** Language used for localized text, with fallback to the course default. */
  lang: string;
  fallbackLang: string;
  /** URL of an asset (export: relative file, editor: API URL). */
  assetUrl: (sha256: string) => string;
  assetMime: (sha256: string) => string | undefined;
  branding: Course['settings']['branding'];
}

export function localized<T>(ctx: RenderContext, value: Record<string, T> | undefined): T | undefined {
  if (!value) return undefined;
  return value[ctx.lang] ?? value[ctx.fallbackLang] ?? Object.values(value)[0];
}

const THEME: Record<string, keyof Course['settings']['branding'] | 'muted' | 'surface'> = {
  'theme:text': 'text',
  'theme:accent': 'accent',
  'theme:background': 'background',
  'theme:muted': 'muted',
  'theme:surface': 'surface',
};

/** Resolves theme color references against the course branding. */
export function color(ctx: RenderContext, value: string | undefined): string | undefined {
  if (!value) return undefined;
  const key = THEME[value];
  if (!key) return value;
  if (key === 'muted') return '#6b7078';
  if (key === 'surface') return '#f3f4f5';
  const resolved = ctx.branding[key];
  return typeof resolved === 'string' ? color(ctx, resolved) : undefined;
}
