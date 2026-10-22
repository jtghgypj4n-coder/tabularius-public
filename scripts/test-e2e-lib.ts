// Which browser test files run alone. A file whose pass mark is a time (the render budgets are three times what a quiet CI runner
// takes) cannot be told from a slow runner while another browser is drawing beside it, so it runs after the rest, by itself.
export const TIMED = ['render-budgets.e2e.ts'];

export type Phase = { files: string[]; args: string[] };

// `args` are the options given to `npm run test:e2e --`; the timed phase keeps them but runs one file at a time.
export function phases(files: string[], args: string[]): Phase[] {
  const timed = (file: string) => TIMED.includes(file.slice(file.lastIndexOf('/') + 1));
  const alone = [...args.filter((arg) => !arg.startsWith('--test-concurrency')), '--test-concurrency=1'];
  return [
    { files: files.filter((file) => !timed(file)), args },
    { files: files.filter(timed), args: alone },
  ].filter((phase) => phase.files.length);
}
