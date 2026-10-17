// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { audioArgs, parseProbe, trimArgs, videoArgs } from './media.js';

describe('media conversion', () => {
  it('reads duration and stream types from ffprobe output', () => {
    const json = JSON.stringify({
      streams: [{ codec_type: 'audio' }],
      format: { duration: '12.345000' },
    });
    expect(parseProbe(json)).toEqual({ durationMs: 12345, hasAudio: true, hasVideo: false });
  });

  it('restricts ffmpeg to local files and strips metadata', () => {
    for (const args of [audioArgs('in.webm', 'out.m4a', true), videoArgs('in.mov', 'out.mp4', 'mp4')]) {
      expect(args.slice(0, 2)).toEqual(['-protocol_whitelist', 'file']);
      expect(args).toContain('-map_metadata');
    }
    expect(audioArgs('in', 'out', true)).toContain('loudnorm=I=-16:TP=-1.5:LRA=11');
    expect(audioArgs('in', 'out', false)).not.toContain('-af');
  });

  it('seeks before the input and limits the duration after it', () => {
    expect(trimArgs(undefined)).toEqual({ before: [], after: [] });
    expect(trimArgs({ startMs: 1500, endMs: 4000 })).toEqual({
      before: ['-ss', '1.500'],
      after: ['-t', '2.500'],
    });
    const args = videoArgs('in.webm', 'out.mp4', 'mp4', { startMs: 2000 });
    expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'));
    expect(args.slice(args.indexOf('-i') + 2, args.indexOf('-i') + 4)).toEqual(['-t', String(3 * 60 * 60)]);
    const audio = audioArgs('in.webm', 'out.m4a', false, { startMs: 0, endMs: 1000 });
    expect(audio).not.toContain('-ss');
    expect(audio.slice(audio.indexOf('-i') + 2, audio.indexOf('-i') + 4)).toEqual(['-t', '1.000']);
  });
});
