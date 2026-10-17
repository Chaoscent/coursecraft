// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { resize, snapMove } from './geometry.js';

const frame = (x: number, y: number, width: number, height: number) => ({ x, y, width, height, rotation: 0 });

describe('snapMove', () => {
  it('snaps to the canvas center and reports a guide', () => {
    const result = snapMove(frame(538, 100, 200, 50), [], { width: 1280, height: 720 }, 6, false);
    expect(result.dx).toBe(2);
    expect(result.guides).toContainEqual({ axis: 'x', at: 640 });
  });

  it('snaps edges to other objects', () => {
    const result = snapMove(
      frame(103, 300, 50, 50),
      [frame(100, 100, 80, 80)],
      { width: 1280, height: 720 },
      6,
      false,
    );
    expect(result.dx).toBe(-3);
  });

  it('uses the grid when nothing is near', () => {
    const result = snapMove(frame(333, 333, 47, 47), [], { width: 1280, height: 720 }, 2, true);
    expect(result.dx).toBe(7);
  });
});

describe('resize', () => {
  it('resizes from the west edge and keeps the right edge', () => {
    expect(resize(frame(100, 100, 200, 100), 'w', 50, 0, false)).toMatchObject({ x: 150, width: 150 });
  });

  it('keeps the aspect ratio on corners when asked', () => {
    const f = resize(frame(0, 0, 200, 100), 'se', 100, 0, true);
    expect(f.width / f.height).toBeCloseTo(2);
  });

  it('never goes below the minimum size', () => {
    expect(resize(frame(0, 0, 50, 50), 'se', -100, -100, false)).toMatchObject({ width: 8, height: 8 });
  });
});
