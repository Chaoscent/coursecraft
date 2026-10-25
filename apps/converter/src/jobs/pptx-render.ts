// SPDX-License-Identifier: Apache-2.0
import type { PptxRenderJob } from '@coursecraft/shared';
import { createCanvas } from '@napi-rs/canvas';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { run } from '../process.js';
import { seedProfile } from './libreoffice-profile.js';

const MAX_PAGES = 1000;
const MAX_PDF_BYTES = 1024 * 1024 * 1024;
const SOFFICE_TIMEOUT_MS = 5 * 60_000;

/** Export filter options: hidden slides are rendered too, so page n is always slide n. */
const PDF_FILTER =
  'pdf:impress_pdf_Export:' +
  JSON.stringify({
    ExportHiddenSlides: { type: 'boolean', value: 'true' },
    ExportNotesPages: { type: 'boolean', value: 'false' },
    UseLosslessCompression: { type: 'boolean', value: 'true' },
  });

const pdfjsRoot = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));

/** LibreOffice → PDF, with a throwaway profile, macros off, and resource limits. */
export async function presentationToPdf(input: string, tmp: string): Promise<string> {
  const profile = join(tmp, 'profile');
  // Linked pictures and other external content are never loaded (SECURITY_AUDIT.md F-19).
  seedProfile(profile);
  await run(
    'soffice',
    [
      `-env:UserInstallation=${pathToFileURL(profile).href}`,
      '--headless',
      '--invisible',
      '--nologo',
      '--norestore',
      '--nolockcheck',
      '--nodefault',
      '--convert-to',
      PDF_FILTER,
      '--outdir',
      tmp,
      input,
    ],
    {
      timeoutMs: SOFFICE_TIMEOUT_MS,
      cpuSeconds: 600,
      maxFileBytes: MAX_PDF_BYTES,
      env: { HOME: tmp, TMPDIR: tmp, SAL_USE_VCLPLUGIN: 'svp' },
    },
  );
  const pdf = join(tmp, 'source.pdf');
  if (statSync(pdf).size > MAX_PDF_BYTES) throw new Error('PDF too large');
  return pdf;
}

/** Renders every PDF page to `page-0001.png` … at the given width. Returns the file names. */
export async function pdfToPngs(pdf: string, outDir: string, widthPx: number): Promise<string[]> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({
    data: new Uint8Array(readFileSync(pdf)),
    disableFontFace: true,
    maxImageSize: 100_000_000,
    useSystemFonts: false,
    standardFontDataUrl: `${join(pdfjsRoot, 'standard_fonts')}/`,
    cMapUrl: `${join(pdfjsRoot, 'cmaps')}/`,
    cMapPacked: true,
    wasmUrl: `${join(pdfjsRoot, 'wasm')}/`,
    iccUrl: `${join(pdfjsRoot, 'iccs')}/`,
    verbosity: 0,
  });
  const doc = await task.promise;
  const names: string[] = [];
  try {
    const count = Math.min(doc.numPages, MAX_PAGES);
    for (let i = 1; i <= count; i++) {
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: widthPx / base.width });
      const canvas = createCanvas(Math.round(viewport.width), Math.round(viewport.height));
      const context = canvas.getContext('2d');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      // pdf.js types expect DOM canvases; @napi-rs/canvas implements the same API.
      const params = { canvas, canvasContext: context, viewport } as unknown as Parameters<
        typeof page.render
      >[0];
      await page.render(params).promise;
      const name = `page-${String(i).padStart(4, '0')}.png`;
      writeFileSync(join(outDir, name), await canvas.encode('png'));
      names.push(name);
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }
  return names;
}

export async function renderPresentation(workDir: string, job: PptxRenderJob): Promise<string[]> {
  const dir = join(workDir, job.jobId);
  const tmp = mkdtempSync(join(tmpdir(), 'cc-pptx-'));
  try {
    const pdf = await presentationToPdf(join(dir, 'in', 'source.pptx'), tmp);
    return await pdfToPngs(pdf, join(dir, 'out'), job.widthPx);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
