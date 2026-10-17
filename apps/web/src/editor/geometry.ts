// SPDX-License-Identifier: Apache-2.0
import type { Frame } from './model.js';

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
export const MIN_SIZE = 8;
export const GRID = 20;

export interface Guide {
  axis: 'x' | 'y';
  at: number;
}

export function bounds(frames: Frame[]): Frame {
  const x = Math.min(...frames.map((f) => f.x));
  const y = Math.min(...frames.map((f) => f.y));
  const right = Math.max(...frames.map((f) => f.x + f.width));
  const bottom = Math.max(...frames.map((f) => f.y + f.height));
  return { x, y, width: right - x, height: bottom - y, rotation: 0 };
}

export function contains(frame: Frame, x: number, y: number): boolean {
  return x >= frame.x && x <= frame.x + frame.width && y >= frame.y && y <= frame.y + frame.height;
}

export function intersects(a: Frame, b: Frame): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/**
 * Snaps a moving box to edges and centers of other objects and the canvas
 * (smart guides); falls back to the grid when enabled.
 */
export function snapMove(
  box: Frame,
  others: Frame[],
  canvas: { width: number; height: number },
  tolerance: number,
  grid: boolean,
) {
  const targetsX = [
    0,
    canvas.width / 2,
    canvas.width,
    ...others.flatMap((o) => [o.x, o.x + o.width / 2, o.x + o.width]),
  ];
  const targetsY = [
    0,
    canvas.height / 2,
    canvas.height,
    ...others.flatMap((o) => [o.y, o.y + o.height / 2, o.y + o.height]),
  ];
  const edgesX = [box.x, box.x + box.width / 2, box.x + box.width];
  const edgesY = [box.y, box.y + box.height / 2, box.y + box.height];
  const best = (edges: number[], targets: number[]) => {
    let result: { delta: number; at: number } | null = null;
    for (const edge of edges) {
      for (const target of targets) {
        const delta = target - edge;
        if (Math.abs(delta) <= tolerance && (!result || Math.abs(delta) < Math.abs(result.delta)))
          result = { delta, at: target };
      }
    }
    return result;
  };
  const sx = best(edgesX, targetsX);
  const sy = best(edgesY, targetsY);
  const guides: Guide[] = [];
  let dx = 0;
  let dy = 0;
  if (sx) {
    dx = sx.delta;
    guides.push({ axis: 'x', at: sx.at });
  } else if (grid) dx = Math.round(box.x / GRID) * GRID - box.x;
  if (sy) {
    dy = sy.delta;
    guides.push({ axis: 'y', at: sy.at });
  } else if (grid) dy = Math.round(box.y / GRID) * GRID - box.y;
  return { dx, dy, guides };
}

export function resize(start: Frame, handle: Handle, dx: number, dy: number, keepRatio: boolean): Frame {
  let { x, y, width, height } = start;
  if (handle.includes('e')) width = start.width + dx;
  if (handle.includes('s')) height = start.height + dy;
  if (handle.includes('w')) {
    width = start.width - dx;
    x = start.x + dx;
  }
  if (handle.includes('n')) {
    height = start.height - dy;
    y = start.y + dy;
  }
  if (keepRatio && handle.length === 2 && start.height > 0) {
    const ratio = start.width / start.height;
    if (width / height > ratio) width = height * ratio;
    else height = width / ratio;
    if (handle.includes('w')) x = start.x + start.width - width;
    if (handle.includes('n')) y = start.y + start.height - height;
  }
  if (width < MIN_SIZE) {
    if (handle.includes('w')) x -= MIN_SIZE - width;
    width = MIN_SIZE;
  }
  if (height < MIN_SIZE) {
    if (handle.includes('n')) y -= MIN_SIZE - height;
    height = MIN_SIZE;
  }
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
    rotation: start.rotation,
  };
}
