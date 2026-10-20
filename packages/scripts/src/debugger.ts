// The script debugger, like FileMaker Pro's: run a script, stop at breakpoints,
// step into, over and out of subscripts, look at variables and evaluate
// formulas (the Data Viewer) while the script waits.
//
//   const d = new ScriptDebugger({ pauseAtStart: true });
//   const state = await d.start(store, 'Close Invoice', { account: 'Admin' });
//   // state.paused: where the script waits
//   await d.resume('over');

import type { Store } from '../../store/src/index.ts';
import type { Script } from '../../fmp12/src/index.ts';
import { ScriptEngine, type DebugAnswer, type DebugPoint, type RunOptions, type RunResult } from './engine.ts';

export type DebugCommand = 'into' | 'over' | 'out' | 'continue' | 'halt';

export interface DebugState {
  /** Where the script waits, with its variables; absent once it has finished. */
  paused?: Omit<DebugPoint, 'variables' | 'evaluate' | 'foundSet' | 'pending'> & { variables: ReturnType<DebugPoint['variables']> };
  /** The run's outcome, once it has finished. */
  done?: RunResult;
  /** The script failed in a way FileMaker would report as a dialog (missing script, privileges). */
  error?: { code: number; message: string };
}

const key = (script: string, index: number) => `${script}\u0000${index}`;

export class ScriptDebugger {
  /** Breakpoints: script name and step index. */
  private readonly breakpoints = new Set<string>();
  private mode: DebugCommand | 'start' = 'continue';
  /** Stack depth when the last step command was given. */
  private depth = 0;
  private point?: DebugPoint;
  private release?: (answer: DebugAnswer) => void;
  /** Pause after any step that sets an error, as FileMaker's "Pause on error" does. */
  pauseOnError = false;
  /** Settles when the script next pauses or finishes. */
  private waiter?: (state: DebugState) => void;
  private outcome?: DebugState;

  constructor(opts: { pauseAtStart?: boolean; pauseOnError?: boolean; breakpoints?: { script: string; index: number }[] } = {}) {
    if (opts.pauseAtStart) this.mode = 'start';
    if (opts.pauseOnError) this.pauseOnError = true;
    for (const b of opts.breakpoints ?? []) this.breakpoints.add(key(b.script, b.index));
  }

  setBreakpoints(list: { script: string; index: number }[]): void {
    this.breakpoints.clear();
    for (const b of list) this.breakpoints.add(key(b.script, b.index));
  }

  listBreakpoints(): { script: string; index: number }[] {
    return [...this.breakpoints].map((k) => {
      const [script, index] = k.split('\u0000');
      return { script, index: Number(index) };
    });
  }

  /** Starts the script; settles when it first pauses or finishes. */
  start(store: Store, script: string | Script, opts: RunOptions = {}): Promise<DebugState> {
    const next = this.next();
    const engine = new ScriptEngine({ ...opts, debug: (p) => this.hook(p) });
    engine.run(store, script).then(
      (done) => this.finish({ done }),
      (e: Error & { code?: number }) => this.finish({ error: { code: typeof e.code === 'number' ? e.code : -1, message: e.message } }),
    );
    return next;
  }

  /** Where the script waits now, or how it ended. */
  state(): DebugState {
    return this.outcome ?? (this.point ? { paused: this.snapshot(this.point) } : {});
  }

  get running(): boolean {
    return !this.outcome;
  }

  /** Steps or continues; settles when the script next pauses or finishes. */
  resume(command: DebugCommand): Promise<DebugState> {
    if (this.outcome) return Promise.resolve(this.outcome);
    if (!this.release) throw new Error('The script is not paused');
    const next = this.next();
    this.mode = command;
    this.depth = this.point?.stack.length ?? 0;
    const release = this.release;
    this.release = undefined;
    this.point = undefined;
    release(command === 'halt' ? 'halt' : undefined);
    return next;
  }

  /**
   * Set Next Step: makes another step of the paused script the one that runs
   * next, without running the steps between; stays paused there.
   */
  setNextStep(index: number): Promise<DebugState> {
    if (this.outcome) return Promise.resolve(this.outcome);
    if (!this.release || !this.point) throw new Error('The script is not paused');
    const steps = this.point.steps;
    if (!Number.isInteger(index) || index < 0 || index >= steps) throw new RangeError(`Step ${index + 1} is not in the script "${this.point.script}"`);
    const next = this.next();
    this.mode = 'start';
    const release = this.release;
    this.release = undefined;
    this.point = undefined;
    release({ next: index });
    return next;
  }

  /** Evaluates a formula where the script waits (the Data Viewer). */
  evaluate(formula: string): { value: string; error?: number; message?: string } {
    if (!this.point) throw new Error('The script is not paused');
    return this.point.evaluate(formula);
  }

  private next(): Promise<DebugState> {
    return new Promise((resolve) => {
      this.waiter = resolve;
    });
  }

  private settle(state: DebugState): void {
    const w = this.waiter;
    this.waiter = undefined;
    w?.(state);
  }

  private finish(state: DebugState): void {
    this.outcome = state;
    this.point = undefined;
    this.release = undefined;
    this.settle(state);
  }

  private shouldPause(p: DebugPoint): boolean {
    if (this.breakpoints.has(key(p.script, p.index))) return true;
    if (this.pauseOnError && p.previousError) return true;
    switch (this.mode) {
      case 'start': case 'into': return true;
      case 'over': return p.stack.length <= this.depth;
      case 'out': return p.stack.length < this.depth;
      default: return false;
    }
  }

  private hook(p: DebugPoint): DebugAnswer | Promise<DebugAnswer> {
    if (!this.shouldPause(p)) return;
    this.point = p;
    const wait = new Promise<DebugAnswer>((resolve) => {
      this.release = resolve;
    });
    this.settle({ paused: this.snapshot(p) });
    return wait;
  }

  private snapshot(p: DebugPoint): NonNullable<DebugState['paused']> {
    const { variables, evaluate: _, foundSet: __, pending: ___, ...rest } = p;
    return { ...rest, variables: variables() };
  }
}
