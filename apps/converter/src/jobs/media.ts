// SPDX-License-Identifier: Apache-2.0
import { CONVERTER_OUTPUT, type MediaJob } from '@coursecraft/shared';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { run } from '../process.js';

const MAX_DURATION_S = 3 * 60 * 60;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024 * 1024;

/** ffmpeg may only read local files: no network protocols, no playlist or concat references. */
const INPUT_GUARD = ['-protocol_whitelist', 'file', '-nostdin', '-hide_banner', '-loglevel', 'error'];

const probeSchema = z.object({
  streams: z.array(z.object({ codec_type: z.string().optional() })).default([]),
  format: z.object({ duration: z.string().optional() }).default({}),
});

export interface Probe {
  durationMs: number;
  hasAudio: boolean;
  hasVideo: boolean;
}

export function parseProbe(json: string): Probe {
  const data = probeSchema.parse(JSON.parse(json));
  const seconds = Number(data.format.duration ?? '0');
  return {
    durationMs: Number.isFinite(seconds) ? Math.round(seconds * 1000) : 0,
    hasAudio: data.streams.some((s) => s.codec_type === 'audio'),
    hasVideo: data.streams.some((s) => s.codec_type === 'video'),
  };
}

const limits = (seconds: number) => ({
  timeoutMs: Math.max(120_000, seconds * 4000),
  cpuSeconds: Math.max(300, seconds * 8),
  maxFileBytes: MAX_OUTPUT_BYTES,
  env: { HOME: '/tmp' },
});

export async function probe(file: string): Promise<Probe> {
  const out = await run(
    'ffprobe',
    [
      '-protocol_whitelist',
      'file',
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      file,
    ],
    limits(60),
  );
  return parseProbe(out);
}

export class UnsupportedMediaError extends Error {}

export type Trim = MediaJob['trim'];

/** Input seeking before `-i` (fast) and a duration limit after it. */
export function trimArgs(trim: Trim): { before: string[]; after: string[] } {
  if (!trim) return { before: [], after: [] };
  const seconds = (ms: number) => (ms / 1000).toFixed(3);
  return {
    before: trim.startMs > 0 ? ['-ss', seconds(trim.startMs)] : [],
    after: trim.endMs !== undefined ? ['-t', seconds(trim.endMs - trim.startMs)] : [],
  };
}

/** Audio: AAC in MP4 (plays everywhere), optional EBU R128 loudness normalisation. */
export function audioArgs(input: string, output: string, normalize: boolean, trim?: Trim): string[] {
  const cut = trimArgs(trim);
  return [
    ...INPUT_GUARD,
    '-y',
    ...cut.before,
    '-i',
    input,
    ...(cut.after.length ? cut.after : ['-t', String(MAX_DURATION_S)]),
    '-map',
    '0:a:0',
    '-vn',
    '-map_metadata',
    '-1',
    ...(normalize ? ['-af', 'loudnorm=I=-16:TP=-1.5:LRA=11'] : []),
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-ar',
    '48000',
    '-movflags',
    '+faststart',
    output,
  ];
}

export function videoArgs(input: string, output: string, format: 'mp4' | 'webm', trim?: Trim): string[] {
  const cut = trimArgs(trim);
  const codec =
    format === 'mp4'
      ? [
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-crf',
          '23',
          '-pix_fmt',
          'yuv420p',
          '-c:a',
          'aac',
          '-b:a',
          '128k',
          '-movflags',
          '+faststart',
        ]
      : [
          '-c:v',
          'libvpx-vp9',
          '-crf',
          '33',
          '-b:v',
          '0',
          '-row-mt',
          '1',
          '-deadline',
          'good',
          '-cpu-used',
          '4',
          '-c:a',
          'libopus',
          '-b:a',
          '96k',
        ];
  return [
    ...INPUT_GUARD,
    '-y',
    ...cut.before,
    '-i',
    input,
    ...(cut.after.length ? cut.after : ['-t', String(MAX_DURATION_S)]),
    '-map',
    '0:v:0',
    '-map',
    '0:a:0?',
    '-map_metadata',
    '-1',
    '-vf',
    "scale='min(1920,iw)':-2",
    ...codec,
    output,
  ];
}

export async function convertMedia(
  workDir: string,
  job: MediaJob,
): Promise<{ outputs: string[]; durationMs: number }> {
  const dir = join(workDir, job.jobId);
  const name = readdirSync(join(dir, 'in')).find((n) => /^source\.[a-z0-9]{2,4}$/.test(n));
  if (!name) throw new UnsupportedMediaError('no input');
  const input = join(dir, 'in', name);
  const info = await probe(input);
  if (info.durationMs > MAX_DURATION_S * 1000) throw new UnsupportedMediaError('duration');
  // Browser recordings (WebM) often declare no duration; the output is capped instead.
  const seconds = info.durationMs > 0 ? Math.ceil(info.durationMs / 1000) : MAX_DURATION_S / 10;
  if (job.trim && info.durationMs > 0 && job.trim.startMs >= info.durationMs) {
    throw new UnsupportedMediaError('trim outside the media');
  }
  const out = (file: string) => join(dir, 'out', file);
  if (job.target === 'audio') {
    if (!info.hasAudio) throw new UnsupportedMediaError('no audio stream');
    await run(
      'ffmpeg',
      audioArgs(input, out(CONVERTER_OUTPUT.audio), job.normalize, job.trim),
      limits(seconds),
    );
    const result = await probe(out(CONVERTER_OUTPUT.audio));
    if (result.durationMs <= 0) throw new UnsupportedMediaError('empty');
    return { outputs: [CONVERTER_OUTPUT.audio], durationMs: result.durationMs };
  }
  if (!info.hasVideo) throw new UnsupportedMediaError('no video stream');
  await run('ffmpeg', videoArgs(input, out(CONVERTER_OUTPUT.videoMp4), 'mp4', job.trim), limits(seconds));
  await run(
    'ffmpeg',
    videoArgs(input, out(CONVERTER_OUTPUT.videoWebm), 'webm', job.trim),
    limits(seconds * 2),
  );
  // Poster from the converted file, so it matches the trimmed start.
  const converted = await probe(out(CONVERTER_OUTPUT.videoMp4));
  if (converted.durationMs <= 0) throw new UnsupportedMediaError('empty');
  await run(
    'ffmpeg',
    [
      ...INPUT_GUARD,
      '-y',
      '-ss',
      String(Math.min(1, converted.durationMs / 2000)),
      '-i',
      out(CONVERTER_OUTPUT.videoMp4),
      '-frames:v',
      '1',
      out(CONVERTER_OUTPUT.poster),
    ],
    limits(30),
  );
  return {
    outputs: [CONVERTER_OUTPUT.videoMp4, CONVERTER_OUTPUT.videoWebm, CONVERTER_OUTPUT.poster],
    durationMs: converted.durationMs,
  };
}
