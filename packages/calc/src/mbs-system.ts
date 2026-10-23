// Small MBS system and path calls. Their vendor results are inferred, not verified.
import type { Env } from './evaluate.ts';
import { num, text, type Value } from './values.ts';

type MbsFunction = (values: Value[], env: Env) => Value;
const argument = (values: Value[], env: Env, index: number) => values[index] === undefined ? '' : env.textOf(values[index]);

export function mbsSystemFunctions(): Record<string, MbsFunction> {
  return {
    // Inferred: report the host process, which may differ from a person's device.
    islinux: () => num(process.platform === 'linux' ? 1 : 0),
    iswindows: () => num(process.platform === 'win32' ? 1 : 0),
    ismac: () => num(process.platform === 'darwin' ? 1 : 0),
    // Inferred: a host without a person is a server for this call.
    isserver: (_values, env) => num(env.ctx.headless ? 1 : 0),
    // Inferred: the vendor logs this call; no corresponding log is available here.
    trace: () => text('OK'),
    // Inferred: use the input path's separator, keeping exactly one at the join.
    'path.addpathcomponent': (values, env) => {
      const path = argument(values, env, 0);
      const component = argument(values, env, 1);
      const separator = path.includes('/') ? '/' : '\\';
      return text(path.replace(/[/\\]+$/, '') + separator + component.replace(/^[/\\]+/, ''));
    },
    // Inferred: a server has no progress dialog to update or cancel.
    'curl.setupdateprogressdialog': () => text('OK'),
    'progressdialog.getcancel': () => num(0),
  };
}
