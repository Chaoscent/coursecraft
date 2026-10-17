// SPDX-License-Identifier: Apache-2.0
import { spawn } from 'node:child_process';

export interface RunOptions {
  timeoutMs: number;
  /** CPU seconds (RLIMIT_CPU). */
  cpuSeconds: number;
  /** Largest file the process may write (RLIMIT_FSIZE). */
  maxFileBytes: number;
  env: Record<string, string>;
  cwd?: string;
}

export class ProcessError extends Error {
  readonly timedOut: boolean;

  constructor(message: string, timedOut: boolean) {
    super(message);
    this.name = 'ProcessError';
    this.timedOut = timedOut;
  }
}

/**
 * Runs a converter tool as a separate process with resource limits
 * (prlimit), a minimal environment, no shell, and a wall-clock timeout that
 * kills the whole process group. Returns stdout.
 */
export function run(command: string, args: readonly string[], options: RunOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'prlimit',
      [
        `--cpu=${options.cpuSeconds}`,
        `--fsize=${options.maxFileBytes}`,
        '--nofile=512',
        '--core=0',
        '--',
        command,
        ...args,
      ],
      {
        env: { PATH: '/usr/local/bin:/usr/bin:/bin', ...options.env },
        cwd: options.cwd,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const out: Buffer[] = [];
    let err = '';
    let timedOut = false;
    child.stdout.on('data', (c: Buffer) => out.push(c));
    child.stderr.on('data', (c: Buffer) => {
      if (err.length < 4000) err += c.toString('utf8');
    });
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL');
      } catch {
        // Already gone.
      }
    }, options.timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(new ProcessError(`${command}: ${error.message}`, false));
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(out).toString('utf8'));
      else
        reject(
          new ProcessError(
            `${command} failed (${timedOut ? 'timeout' : (signal ?? `exit ${code}`)}): ${err.trim().slice(-500)}`,
            timedOut,
          ),
        );
    });
  });
}
