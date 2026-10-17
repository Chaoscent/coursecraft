// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { audioArgs, parseProbe, videoArgs } from './media.js';

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
});
