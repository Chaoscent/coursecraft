// SPDX-License-Identifier: Apache-2.0
const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
};
const u16 = (n: number) => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
};
const ascii = (s: string) => Buffer.from(s, 'latin1');

/** Mono 16-bit PCM WAV with a sine tone (test fixtures). */
export function sineWav(seconds: number, frequency = 440, rate = 16_000): Buffer {
  const samples = Math.round(seconds * rate);
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++)
    data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * frequency * i) / rate) * 12_000), i * 2);
  return Buffer.concat([
    ascii('RIFF'),
    u32(36 + data.length),
    ascii('WAVEfmt '),
    u32(16),
    u16(1),
    u16(1),
    u32(rate),
    u32(rate * 2),
    u16(2),
    u16(16),
    ascii('data'),
    u32(data.length),
    data,
  ]);
}
