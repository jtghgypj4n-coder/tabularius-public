// The server log's account of requests addressed to a DNS name nobody told the server about. A client that makes up
// names must not be able to use up the log's attention, so the lines are budgeted per window instead of once for
// good: the first names of a window are logged one by one, and the rest are counted and reported together when the
// window ends, most-asked first, so a real client's name that keeps coming shows up behind any number of one-off names.

/** The length of a window, in milliseconds. */
export const REFUSED_HOST_WINDOW_MS = 10 * 60_000;
/** The most names logged one by one in a window. */
export const REFUSED_HOST_LINES = 16;
/** The most distinct names counted in a window; more are counted together as "others". */
export const REFUSED_HOST_TABLE = 1000;
/** The longest a host name can be; a longer one is not a name to configure and is counted, never written. */
export const REFUSED_HOST_NAME_MAX = 253;
const TOP = 5;

export class RefusedHostLog {
  private readonly counts = new Map<string, number>();
  private readonly logged = new Set<string>();
  private others = 0;
  private tooLong = 0;
  private windowStart?: number;

  private readonly write: (line: string) => void;

  constructor(write: (line: string) => void) { this.write = write; }

  /** How many names are being counted now (bounded by REFUSED_HOST_TABLE). */
  get size(): number { return this.counts.size; }

  /** A request addressed to `name` was refused. */
  note(name: string, now = Date.now()): void {
    if (this.windowStart === undefined || now - this.windowStart >= REFUSED_HOST_WINDOW_MS) {
      this.summarise();
      this.windowStart = now;
    }
    if (name.length > REFUSED_HOST_NAME_MAX) { this.tooLong++; return; }
    const seen = this.counts.get(name);
    if (seen !== undefined) this.counts.set(name, seen + 1);
    else if (this.counts.size < REFUSED_HOST_TABLE) this.counts.set(name, 1);
    else { this.others++; return; }
    if (!this.logged.has(name) && this.logged.size < REFUSED_HOST_LINES) {
      this.logged.add(name);
      this.write(`A request addressed to the host name ${name} was refused: this server was not told that name. Start it with --public-url https://${name} (or --https ${name}) to use it.`);
    }
  }

  /** One line for the names of the window that ended and were not logged one by one. */
  private summarise(): void {
    const left = [...this.counts].filter(([name]) => !this.logged.has(name)).sort((a, b) => b[1] - a[1]);
    const total = left.length + this.others;
    const others = this.others;
    const tooLong = this.tooLong;
    this.counts.clear();
    this.logged.clear();
    this.others = 0;
    this.tooLong = 0;
    if (!total && !tooLong) return;
    const top = left.slice(0, TOP).map(([name, n]) => `${name} (${n} ${n === 1 ? 'time' : 'times'})`).join(', ');
    const parts = [
      total ? `${total} more host names were refused in the last ${REFUSED_HOST_WINDOW_MS / 60_000} minutes and not logged one by one${top ? `; asked for most often: ${top}` : ''}${others ? `; ${others} more requests came for names beyond the ${REFUSED_HOST_TABLE} counted` : ''}` : '',
      tooLong ? `${tooLong} requests named a host longer than a host name can be (over ${REFUSED_HOST_NAME_MAX} characters) and were refused` : '',
    ].filter(Boolean);
    this.write(`${parts.join('; ')}. ${total ? 'A name that is yours needs --public-url or --https.' : 'Nothing to configure for those.'}`);
  }
}
