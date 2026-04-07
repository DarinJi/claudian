import { type ChildProcess, spawn } from 'child_process';
import type { Readable, Writable } from 'stream';

import type { CopilotLaunchSpec } from './copilotLaunchTypes';

const SIGKILL_TIMEOUT_MS = 3_000;

type ExitCallback = (code: number | null, signal: string | null) => void;
type ErrorCallback = (error: Error) => void;

export class CopilotCliProcess {
  private proc: ChildProcess | null = null;
  private alive = false;
  private exitCallbacks: ExitCallback[] = [];
  private errorCallbacks: ErrorCallback[] = [];

  constructor(private readonly launchSpec: CopilotLaunchSpec) {}

  start(): void {
    this.proc = spawn(this.launchSpec.command, this.launchSpec.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: this.launchSpec.spawnCwd,
      env: this.launchSpec.env,
    });

    this.alive = true;

    this.proc.on('exit', (code, signal) => {
      this.alive = false;
      for (const cb of this.exitCallbacks) {
        cb(code, signal);
      }
    });

    this.proc.on('error', (error) => {
      this.alive = false;
      for (const cb of this.errorCallbacks) {
        cb(error);
      }
    });
  }

  get stdin(): Writable {
    if (!this.proc?.stdin) throw new Error('Process not started');
    return this.proc.stdin;
  }

  get stdout(): Readable {
    if (!this.proc?.stdout) throw new Error('Process not started');
    return this.proc.stdout;
  }

  get stderr(): Readable {
    if (!this.proc?.stderr) throw new Error('Process not started');
    return this.proc.stderr;
  }

  isAlive(): boolean {
    return this.alive;
  }

  onExit(callback: ExitCallback): void {
    this.exitCallbacks.push(callback);
  }

  offExit(callback: ExitCallback): void {
    const idx = this.exitCallbacks.indexOf(callback);
    if (idx !== -1) this.exitCallbacks.splice(idx, 1);
  }

  onError(callback: ErrorCallback): void {
    this.errorCallbacks.push(callback);
  }

  async shutdown(): Promise<void> {
    if (!this.proc || !this.alive) return;

    await new Promise<void>((resolve) => {
      const onExit = () => {
        clearTimeout(killTimer);
        resolve();
      };

      this.proc!.once('exit', onExit);
      this.proc!.kill('SIGTERM');

      const killTimer = setTimeout(() => {
        if (this.alive) {
          this.proc!.kill('SIGKILL');
        }
      }, SIGKILL_TIMEOUT_MS);
    });
  }
}