// SPDX-License-Identifier: Apache-2.0
import { assetSchema, type Asset } from '@coursecraft/shared';
import { api } from '../api/client.js';

export async function uploadAsset(courseId: string, file: File): Promise<Asset> {
  const form = new FormData();
  form.append('file', file, file.name);
  return api(assetSchema, `/api/courses/${courseId}/assets`, { method: 'POST', form });
}

export function assetUrl(courseId: string, sha256: string): string {
  return `/api/courses/${courseId}/assets/${sha256}`;
}

/** Natural size of an image file, for initial placement. */
export function imageSize(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth || 400, height: img.naturalHeight || 300 });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve({ width: 400, height: 300 });
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}

/** Opens the file chooser and resolves with the chosen file. */
export function chooseFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}
