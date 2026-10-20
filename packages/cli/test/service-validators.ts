// Strict structural checks of the files `tabularius service install` writes: a launchd plist, a systemd unit and a Windows
// Task Scheduler task. Each returns the problems it found (empty = valid). They know only what the generators use and what the
// vendor documents, and refuse the rest: an unknown key or element is a problem, so a typo or a copied directive is caught.
//
// Sources:
//   plist    the DTD named in the DOCTYPE (http://www.apple.com/DTDs/PropertyList-1.0.dtd): plist holds one value; dict is
//            (key, value)*; array is value*; string/key/data/date/real/integer hold text; true and false are empty.
//            The launchd keys are those of launchd.plist(5) the generator writes.
//   systemd  systemd.syntax(7), systemd.unit(5), systemd.service(5), systemd.exec(5), systemd.kill(5), systemd.time(7).
//   task     Microsoft's Task Scheduler schema (taskschd/task-scheduler-schema): Task and Settings are xs:all (any order, each
//            once), Actions is required, LogonType and RunLevel are enumerations, RestartOnFailure has Interval PT1M..P31D and
//            Count 1..255.
// Not checked, because it is not documented in a form a test can use: that Windows or macOS accepts the file at install time.

// ---- A strict XML reader (enough for these files) -------------------------------------------------------------------

export interface XmlNode { name: string; attrs: Record<string, string>; children: XmlNode[]; text: string }

const NAME = '[A-Za-z_][A-Za-z0-9_.:-]*';
const BAD_XML_CHAR = /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/;

export function parseXml(text: string, problems: string[]): XmlNode | undefined {
  let src = text;
  if (BAD_XML_CHAR.test(src)) problems.push('a character that XML 1.0 does not allow');
  src = src.replace(/^<\?xml[^>]*\?>\s*/, '').replace(/^<!DOCTYPE[^>]*>\s*/, '');
  const root: XmlNode = { name: '#document', attrs: {}, children: [], text: '' };
  const stack: XmlNode[] = [root];
  const token = new RegExp(`<(/)?(${NAME})((?:\\s+${NAME}="[^"<]*")*)\\s*(/)?>|([^<]+)|(<!--[\\s\\S]*?-->)`, 'y');
  let at = 0;
  while (at < src.length) {
    token.lastIndex = at;
    const m = token.exec(src);
    if (!m) { problems.push(`not well-formed near ${JSON.stringify(src.slice(at, at + 30))}`); return undefined; }
    at = token.lastIndex;
    const [, closing, name, attrText, selfClosing, chars] = m;
    const top = stack[stack.length - 1];
    if (chars !== undefined) {
      for (const ref of chars.matchAll(/&([^;\s]*);?/g)) if (!/^(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+)$/.test(ref[1]) || !ref[0].endsWith(';')) problems.push(`an entity that is not one of the five XML ones: ${ref[0]}`);
      top.text += chars;
    } else if (name) {
      if (closing) {
        if (top.name !== name || stack.length < 2) { problems.push(`</${name}> closes ${top.name}`); return undefined; }
        stack.pop();
      } else {
        const attrs: Record<string, string> = {};
        for (const a of (attrText ?? '').matchAll(new RegExp(`(${NAME})="([^"]*)"`, 'g'))) {
          if (a[1] in attrs) problems.push(`${name} has the attribute ${a[1]} twice`);
          attrs[a[1]] = a[2];
        }
        const node: XmlNode = { name, attrs, children: [], text: '' };
        top.children.push(node);
        if (!selfClosing) stack.push(node);
      }
    }
  }
  if (stack.length !== 1) { problems.push(`<${stack[stack.length - 1].name}> is never closed`); return undefined; }
  if (root.children.length !== 1) { problems.push('a document has exactly one root element'); return undefined; }
  if (root.text.trim()) problems.push('text outside the root element');
  return root.children[0];
}

const unxml = (s: string) => s.replace(/&(amp|lt|gt|quot|apos);/g, (_, n: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[n] as string));

// ---- launchd property list -----------------------------------------------------------------------------------------------

export type PlistValue = string | number | boolean | PlistValue[] | { [k: string]: PlistValue };

function plistValue(n: XmlNode, problems: string[], where: string): PlistValue | undefined {
  switch (n.name) {
    case 'true': case 'false': if (n.children.length || n.text.trim()) problems.push(`${where}: <${n.name}/> is empty`); return n.name === 'true';
    case 'string': if (n.children.length) problems.push(`${where}: a string holds text only`); return unxml(n.text);
    case 'integer': if (!/^-?\d+$/.test(n.text.trim())) problems.push(`${where}: ${JSON.stringify(n.text)} is not an integer`); return Number(n.text.trim());
    case 'real': if (!/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(n.text.trim())) problems.push(`${where}: ${JSON.stringify(n.text)} is not a real`); return Number(n.text.trim());
    case 'array': return n.children.map((c, i) => plistValue(c, problems, `${where}[${i}]`)).filter((v): v is PlistValue => v !== undefined);
    case 'dict': {
      const out: { [k: string]: PlistValue } = {};
      for (let i = 0; i < n.children.length;) {
        const k = n.children[i];
        if (k.name !== 'key') { problems.push(`${where}: expected <key>, found <${k.name}>`); i++; continue; }
        const key = unxml(k.text);
        if (key in out) problems.push(`${where}: the key ${key} appears twice`);
        const v = n.children[i + 1];
        if (!v || v.name === 'key') { problems.push(`${where}: the key ${key} has no value`); i++; continue; }
        const val = plistValue(v, problems, `${where}.${key}`);
        if (val !== undefined) out[key] = val;
        i += 2;
      }
      return out;
    }
    default: problems.push(`${where}: <${n.name}> is not a property list value`); return undefined;
  }
}

const RESOURCE_LIMITS = ['Core', 'CPU', 'Data', 'FileSize', 'MemoryLock', 'NumberOfFiles', 'NumberOfProcesses', 'ResidentSetSize', 'Stack'];
const PLIST_KEYS: Record<string, (v: PlistValue, problems: string[]) => void> = {
  Label: (v, p) => { if (typeof v !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(v)) p.push('Label is a reverse-DNS style name'); },
  ProgramArguments: (v, p) => { if (!Array.isArray(v) || !v.length || !v.every((x) => typeof x === 'string')) p.push('ProgramArguments is a non-empty array of strings'); else if (!(v[0] as string).startsWith('/')) p.push('ProgramArguments[0] must be a full path'); },
  RunAtLoad: (v, p) => { if (typeof v !== 'boolean') p.push('RunAtLoad is true or false'); },
  KeepAlive: (v, p) => { if (typeof v !== 'boolean' && (typeof v !== 'object' || Array.isArray(v))) p.push('KeepAlive is a boolean or a dict'); },
  ExitTimeOut: (v, p) => { if (!Number.isInteger(v) || (v as number) < 1) p.push('ExitTimeOut is a positive integer (seconds)'); },
  ThrottleInterval: (v, p) => { if (!Number.isInteger(v) || (v as number) < 1) p.push('ThrottleInterval is a positive integer (seconds)'); },
  Umask: (v, p) => { if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > 0o777) p.push('Umask is an integer from 0 to 511 (decimal; 63 is octal 077)'); },
  UserName: (v, p) => { if (typeof v !== 'string' || !/^[A-Za-z0-9_][A-Za-z0-9_.@-]*$/.test(v)) p.push('UserName is an account name'); },
  WorkingDirectory: (v, p) => { if (typeof v !== 'string' || !v.startsWith('/')) p.push('WorkingDirectory is a full path'); },
  StandardOutPath: (v, p) => { if (typeof v !== 'string' || !v.startsWith('/')) p.push('StandardOutPath is a full path'); },
  StandardErrorPath: (v, p) => { if (typeof v !== 'string' || !v.startsWith('/')) p.push('StandardErrorPath is a full path'); },
  SoftResourceLimits: (v, p) => {
    if (typeof v !== 'object' || Array.isArray(v)) { p.push('SoftResourceLimits is a dict'); return; }
    for (const [k, n] of Object.entries(v)) if (!RESOURCE_LIMITS.includes(k) || !Number.isInteger(n) || (n as number) < 0) p.push(`SoftResourceLimits.${k} is not a known limit with a whole number`);
  },
};

/** The top-level dict of a property list (for tests that need the values, not only the verdict). */
export function readPlist(text: string): { [k: string]: PlistValue } {
  const problems: string[] = [];
  const root = parseXml(text, problems);
  if (!root || problems.length || root.children[0]?.name !== 'dict') throw new Error(`not a property list: ${problems.join('; ')}`);
  return plistValue(root.children[0], problems, 'plist') as { [k: string]: PlistValue };
}

/** `system`: a LaunchDaemon (runs as a named user at boot) rather than a LaunchAgent. */
export function validatePlist(text: string, system: boolean): string[] {
  const problems: string[] = [];
  if (!/^<\?xml version="1\.0" encoding="UTF-8"\?>\n<!DOCTYPE plist PUBLIC "-\/\/Apple\/\/DTD PLIST 1\.0\/\/EN" "http:\/\/www\.apple\.com\/DTDs\/PropertyList-1\.0\.dtd">\n<plist version="1\.0">/.test(text)) problems.push('the XML declaration, the Apple DOCTYPE and <plist version="1.0"> must come first, exactly as Apple publishes them');
  if (/\r/.test(text)) problems.push('CR in the file');
  const root = parseXml(text, problems);
  if (!root) return problems;
  if (root.name !== 'plist') problems.push(`the root is <${root.name}>, not <plist>`);
  if (Object.keys(root.attrs).join() !== 'version' || root.attrs.version !== '1.0') problems.push('<plist> has only version="1.0"');
  if (root.children.length !== 1 || root.children[0].name !== 'dict') { problems.push('<plist> holds one <dict>'); return problems; }
  const dict = plistValue(root.children[0], problems, 'plist') as { [k: string]: PlistValue };
  if (!dict || typeof dict !== 'object') return problems;
  for (const [key, value] of Object.entries(dict)) {
    const check = PLIST_KEYS[key];
    if (!check) problems.push(`${key} is not a launchd.plist key this generator may write`);
    else check(value, problems);
  }
  for (const required of ['Label', 'ProgramArguments']) if (!(required in dict)) problems.push(`${required} is required`);
  if (system && !('UserName' in dict)) problems.push('a LaunchDaemon names the user it runs as (UserName), or it runs as root');
  if (!system && 'UserName' in dict) problems.push('a LaunchAgent runs as the logged-in user: UserName is ignored there');
  if (dict.RunAtLoad !== true) problems.push('RunAtLoad must be true or the service does not start when loaded');
  if (dict.KeepAlive !== true) problems.push('KeepAlive must be true for it to start again after a crash');
  return problems;
}

// ---- systemd unit ---------------------------------------------------------------------------------------------------------

const BOOL = /^(yes|no|true|false|on|off|1|0)$/;
const TIMESPAN = /^(infinity|(\d+(\.\d+)?(usec|us|msec|ms|seconds|second|sec|s|minutes|minute|min|m|hours|hour|hr|h|days|day|d|weeks|week|w)?\s*)+)$/;
/** Words as systemd splits them: whitespace separated, with double or single quotes and backslash escapes. */
export function systemdWords(value: string, problems: string[] = []): string[] {
  const out: string[] = [];
  let cur = '';
  let inWord = false;
  let quote: string | undefined;
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (quote) {
      if (c === '\\' && i + 1 < value.length) { cur += value[++i]; continue; }
      if (c === quote) { quote = undefined; continue; }
      cur += c;
    } else if (c === '"' || c === "'") { quote = c; inWord = true; }
    else if (/\s/.test(c)) { if (inWord) { out.push(cur); cur = ''; inWord = false; } }
    else if (c === '\\' && i + 1 < value.length) { cur += value[++i]; inWord = true; }
    else { cur += c; inWord = true; }
  }
  if (quote) problems.push(`an unclosed ${quote} in: ${value.slice(0, 60)}`);
  if (inWord) out.push(cur);
  return out;
}
/** `%` must be `%%` and `$` must be `$$`, or systemd expands them (specifiers, environment variables). */
const expansion = (word: string) => /%(?!%)|(?<!\$)\$(?!\$)/.test(word.replace(/%%/g, '').replace(/\$\$/g, ''));
const absPath = (w: string) => w.startsWith('/') && !/\/\.\.?(\/|$)/.test(w);

type Check = (value: string, problems: string[], name: string) => void;
const one = (re: RegExp, what: string): Check => (v, p, n) => { if (!re.test(v)) p.push(`${n}=${v}: ${what}`); };
const SYSTEMD: Record<string, Record<string, Check>> = {
  Unit: {
    Description: (v, p) => { if (!v.trim()) p.push('Description is empty'); },
    After: one(/^[A-Za-z0-9:_.@\\-]+\.(target|service|socket|mount)( [A-Za-z0-9:_.@\\-]+\.(target|service|socket|mount))*$/, 'unit names'),
    Wants: one(/^[A-Za-z0-9:_.@\\-]+\.(target|service|socket|mount)( [A-Za-z0-9:_.@\\-]+\.(target|service|socket|mount))*$/, 'unit names'),
  },
  Service: {
    ExecStart: (v, p) => {
      const words = systemdWords(v, p);
      if (!words.length) { p.push('ExecStart is empty'); return; }
      if (!absPath(words[0].replace(/^[@\-:+!]+/, ''))) p.push(`ExecStart: the program must be a full path, found ${words[0]}`);
      for (const w of words) if (expansion(w)) p.push(`ExecStart: ${w.slice(0, 40)}… holds a % or $ that systemd would expand; it must be doubled`);
    },
    WorkingDirectory: (v, p) => {
      if (!absPath(v.replace(/%%/g, '%'))) p.push(`WorkingDirectory is a full path: ${v}`);
      if (/%(?!%)/.test(v.replace(/%%/g, ''))) p.push('WorkingDirectory: a % that systemd would expand; it must be doubled');
    },
    Restart: one(/^(no|on-success|on-failure|on-abnormal|on-watchdog|on-abort|always)$/, 'not a Restart value'),
    RestartSec: one(TIMESPAN, 'a time span'),
    RestartSteps: one(/^\d+$/, 'a whole number'),
    RestartMaxDelaySec: one(TIMESPAN, 'a time span'),
    TimeoutStopSec: one(TIMESPAN, 'a time span'),
    LimitNOFILE: one(/^(\d+|infinity)$/, 'a number or infinity'),
    UMask: one(/^0[0-7]{3}$/, 'an octal mode of four digits'),
    NoNewPrivileges: one(BOOL, 'a boolean'),
    PrivateTmp: one(BOOL, 'a boolean'),
    ProtectSystem: one(/^(yes|no|true|false|full|strict)$/, 'yes, no, full or strict'),
    ReadWritePaths: (v, p) => {
      for (const w of systemdWords(v, p)) {
        const path = w.replace(/^[-+]/, '');
        if (!absPath(path.replace(/%%/g, '%'))) p.push(`ReadWritePaths: ${w} is not a full path`);
        if (/%(?!%)/.test(path.replace(/%%/g, ''))) p.push(`ReadWritePaths: ${w} holds a % that systemd would expand`);
      }
    },
    ProtectKernelTunables: one(BOOL, 'a boolean'),
    ProtectControlGroups: one(BOOL, 'a boolean'),
    RestrictSUIDSGID: one(BOOL, 'a boolean'),
    RestrictRealtime: one(BOOL, 'a boolean'),
    LockPersonality: one(BOOL, 'a boolean'),
    User: one(/^[A-Za-z0-9_][A-Za-z0-9_.@-]*$/, 'an account name'),
    AmbientCapabilities: one(/^CAP_[A-Z_]+( CAP_[A-Z_]+)*$/, 'capability names'),
  },
  Install: {
    WantedBy: one(/^(multi-user|default)\.target$/, 'multi-user.target (system) or default.target (user)'),
  },
};

/** A systemd unit file as `parse` sees it: `[section, name, value]` in order, with continuation lines joined. */
export function parseUnit(text: string, problems: string[]): Array<[string, string, string]> {
  const out: Array<[string, string, string]> = [];
  if (/\r/.test(text)) problems.push('CR in the file');
  if (!text.endsWith('\n')) problems.push('the file does not end with a line feed');
  let section = '';
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    if (/[\u0000-\u0008\u000b-\u001f\u007f]/.test(line)) problems.push(`line ${i + 1}: a control character`);
    if (/^\s*[#;]/.test(line) || !line.trim()) continue;
    // systemd joins a line that ends in a backslash with the next, and skips comment lines in between. The generator never needs that, so it is a problem.
    if (/\\$/.test(line)) {
      problems.push(`line ${i + 1}: ends in a backslash, so systemd joins the next setting onto it`);
      while (/\\$/.test(line) && i + 1 < lines.length) { i++; if (/^\s*[#;]/.test(lines[i])) continue; line = `${line.slice(0, -1)} ${lines[i]}`; }
    }
    const header = /^\[([A-Za-z]+)\]$/.exec(line);
    if (header) { section = header[1]; if (!SYSTEMD[section]) problems.push(`line ${i + 1}: [${section}] is not a section this generator may write`); continue; }
    const m = /^([A-Za-z][A-Za-z0-9]*)=(.*)$/.exec(line);
    if (!m) { problems.push(`line ${i + 1}: neither a section, a comment nor Name=value: ${line.slice(0, 40)}`); continue; }
    if (!section) { problems.push(`line ${i + 1}: a directive before any section`); continue; }
    out.push([section, m[1], m[2]]);
  }
  return out;
}

/** `system`: a unit in /etc/systemd/system for boot, rather than a user unit. */
export function validateSystemdUnit(text: string, system: boolean): string[] {
  const problems: string[] = [];
  const entries = parseUnit(text, problems);
  const seen = new Set<string>();
  for (const [section, name, value] of entries) {
    const check = SYSTEMD[section]?.[name];
    if (!check) { problems.push(`${section}: ${name} is not a directive this generator may write`); continue; }
    if (seen.has(`${section}.${name}`) && !['After', 'Wants'].includes(name)) problems.push(`${section}: ${name} appears twice`);
    seen.add(`${section}.${name}`);
    check(value, problems, name);
  }
  for (const need of ['Service.ExecStart', 'Install.WantedBy']) if (!seen.has(need)) problems.push(`${need} is required`);
  const get = (k: string) => entries.find(([s, n]) => `${s}.${n}` === k)?.[2];
  if (system) {
    if (!seen.has('Service.User')) problems.push('a system unit names the user it runs as, or it runs as root');
    if (get('Install.WantedBy') !== 'multi-user.target') problems.push('a system unit is wanted by multi-user.target');
  } else {
    if (seen.has('Service.User')) problems.push('a user unit runs as its user: User= is refused there');
    if (seen.has('Service.AmbientCapabilities')) problems.push('a user unit cannot be given capabilities');
    if (get('Install.WantedBy') !== 'default.target') problems.push('a user unit is wanted by default.target');
  }
  if (seen.has('Service.AmbientCapabilities') && !seen.has('Service.User')) problems.push('AmbientCapabilities without User= gives root nothing and a named user what it asked for; name the user');
  if (seen.has('Service.RestartSteps') && !seen.has('Service.RestartMaxDelaySec')) problems.push('RestartSteps needs RestartMaxDelaySec to mean anything');
  const timeout = get('Service.TimeoutStopSec');
  if (!timeout || /^infinity$/.test(timeout)) problems.push('TimeoutStopSec must be finite: a stuck server must be ended');
  if ((get('Service.Restart') ?? 'no') === 'no') problems.push('Restart must be set or a crash leaves it down');
  if (/^(yes|true|1|on)$/.test(get('Service.MemoryDenyWriteExecute') ?? '')) problems.push('MemoryDenyWriteExecute stops Node (V8 needs memory that is written and run)');
  return problems;
}

// ---- Windows Task Scheduler task -----------------------------------------------------------------------------------------

const TASK_NS = 'http://schemas.microsoft.com/windows/2004/02/mit/task';
const SETTINGS: Record<string, (v: string, p: string[]) => void> = {
  AllowStartOnDemand: bool, DisallowStartIfOnBatteries: bool, StopIfGoingOnBatteries: bool, AllowHardTerminate: bool, StartWhenAvailable: bool,
  RunOnlyIfNetworkAvailable: bool, WakeToRun: bool, Enabled: bool, Hidden: bool, RunOnlyIfIdle: bool,
  MultipleInstancesPolicy: (v, p) => { if (!['Parallel', 'Queue', 'IgnoreNew', 'StopExisting'].includes(v)) p.push(`MultipleInstancesPolicy ${v}`); },
  ExecutionTimeLimit: (v, p) => { if (!/^P(?!$)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+S)?)?$/.test(v)) p.push(`ExecutionTimeLimit ${v} is not an xs:duration`); },
  Priority: (v, p) => { if (!/^([0-9]|10)$/.test(v)) p.push(`Priority ${v} is 0 to 10`); },
};
function bool(v: string, p: string[]) { if (!['true', 'false'].includes(v)) p.push(`${JSON.stringify(v)} is not true or false`); }

/** Whole seconds of the simple durations the generator uses (PTnM, PTnS, PTnH, PnD). */
function seconds(d: string): number | undefined {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(d);
  return m ? (Number(m[1] ?? 0) * 86400 + Number(m[2] ?? 0) * 3600 + Number(m[3] ?? 0) * 60 + Number(m[4] ?? 0)) : undefined;
}

const once = (node: XmlNode, allowed: readonly string[], where: string, p: string[]) => {
  const names = node.children.map((c) => c.name);
  for (const n of names) if (!allowed.includes(n)) p.push(`${where}: <${n}> is not an element it may hold`);
  for (const n of new Set(names)) if (names.filter((x) => x === n).length > 1) p.push(`${where}: <${n}> appears more than once`);
};
const leaf = (node: XmlNode, p: string[], where: string) => { if (node.children.length) p.push(`${where} holds text only`); return unxml(node.text); };

export function validateTaskXml(text: string, system: boolean): string[] {
  const problems: string[] = [];
  if (!/^<\?xml version="1\.0" encoding="UTF-16"\?>\n/.test(text)) problems.push('the declaration says UTF-16, which is how the file is written');
  if (/\r/.test(text)) problems.push('CR in the file (written with LF)');
  const task = parseXml(text, problems);
  if (!task) return problems;
  if (task.name !== 'Task') problems.push(`the root is <${task.name}>, not <Task>`);
  if (task.attrs.xmlns !== TASK_NS) problems.push(`xmlns must be ${TASK_NS}`);
  if (task.attrs.version !== '1.2') problems.push('version="1.2" (RestartOnFailure needs 1.2 or later)');
  if (Object.keys(task.attrs).sort().join() !== 'version,xmlns') problems.push('Task has only xmlns and version');
  once(task, ['RegistrationInfo', 'Triggers', 'Settings', 'Data', 'Principals', 'Actions'], 'Task', problems);
  const child = (n: string) => task.children.find((c) => c.name === n);

  const actions = child('Actions');
  if (!actions) problems.push('Actions is required');
  else {
    if (actions.children.length !== 1 || actions.children[0].name !== 'Exec') problems.push('Actions holds one Exec');
    for (const exec of actions.children) {
      once(exec, ['Command', 'Arguments', 'WorkingDirectory'], 'Exec', problems);
      const command = exec.children.find((c) => c.name === 'Command');
      if (!command || !leaf(command, problems, 'Command').trim()) problems.push('Exec needs a Command');
      else if (!/^([A-Za-z]:\\|\\\\|\/)/.test(leaf(command, problems, 'Command'))) problems.push('Command is a full path');
    }
  }

  const principals = child('Principals');
  const principalIds: string[] = [];
  if (principals) {
    if (principals.children.length !== 1) problems.push('Principals holds one Principal');
    for (const pr of principals.children) {
      if (pr.name !== 'Principal') { problems.push(`Principals holds <${pr.name}>`); continue; }
      principalIds.push(pr.attrs.id ?? '');
      once(pr, ['UserId', 'GroupId', 'LogonType', 'RunLevel', 'DisplayName', 'ProcessTokenSidType', 'RequiredPrivileges'], 'Principal', problems);
      const get = (n: string) => pr.children.find((c) => c.name === n);
      const logon = get('LogonType');
      if (logon && !['S4U', 'Password', 'InteractiveToken', 'InteractiveTokenOrPassword'].includes(leaf(logon, problems, 'LogonType'))) problems.push(`LogonType ${leaf(logon, problems, 'LogonType')}`);
      const run = get('RunLevel');
      if (run && !['LeastPrivilege', 'HighestAvailable'].includes(leaf(run, problems, 'RunLevel'))) problems.push(`RunLevel ${leaf(run, problems, 'RunLevel')}`);
      const user = get('UserId') ? leaf(get('UserId')!, problems, 'UserId') : '';
      if (!user) problems.push('Principal names a UserId');
      if (system && user !== 'S-1-5-18') problems.push('a boot task runs as the system account S-1-5-18');
      if (!system && (user === 'S-1-5-18' || get('RunLevel') && leaf(get('RunLevel')!, problems, 'RunLevel') !== 'LeastPrivilege')) problems.push('a logon task runs as the user with LeastPrivilege');
      if (!system && logon && leaf(logon, problems, 'LogonType') !== 'InteractiveToken') problems.push('a logon task uses InteractiveToken: no password is stored');
    }
  } else problems.push('Principals is needed to say which account runs it');
  if (actions && actions.attrs.Context !== undefined && !principalIds.includes(actions.attrs.Context)) problems.push(`Actions Context="${actions.attrs.Context}" names no Principal`);

  const triggers = child('Triggers');
  if (!triggers) problems.push('Triggers is needed or the task never starts by itself');
  else {
    if (triggers.children.length !== 1) problems.push('Triggers holds one trigger');
    for (const t of triggers.children) {
      if (!['BootTrigger', 'LogonTrigger'].includes(t.name)) problems.push(`<${t.name}> is not a trigger this generator may write`);
      if (system && t.name !== 'BootTrigger') problems.push('a boot task uses BootTrigger');
      if (!system && t.name !== 'LogonTrigger') problems.push('a logon task uses LogonTrigger');
      once(t, ['Enabled', 'UserId', 'Delay', 'StartBoundary', 'EndBoundary', 'Repetition', 'ExecutionTimeLimit', 'Id'], t.name, problems);
      for (const e of t.children.filter((c) => c.name === 'Enabled')) bool(leaf(e, problems, 'Enabled'), problems);
    }
  }

  const settings = child('Settings');
  if (settings) {
    once(settings, [...Object.keys(SETTINGS), 'RestartOnFailure', 'IdleSettings', 'DeleteExpiredTaskAfter', 'NetworkSettings', 'NetworkProfileName', 'UseUnifiedSchedulingEngine', 'DisallowStartOnRemoteAppSession'], 'Settings', problems);
    for (const s of settings.children) {
      if (SETTINGS[s.name]) SETTINGS[s.name](leaf(s, problems, s.name), problems);
      if (s.name === 'RestartOnFailure') {
        once(s, ['Interval', 'Count'], 'RestartOnFailure', problems);
        const interval = s.children.find((c) => c.name === 'Interval');
        const count = s.children.find((c) => c.name === 'Count');
        if (!interval || !count) problems.push('RestartOnFailure needs both Interval and Count');
        else {
          const secs = seconds(leaf(interval, problems, 'Interval'));
          if (secs === undefined || secs < 60 || secs > 31 * 86400) problems.push(`RestartOnFailure Interval ${leaf(interval, problems, 'Interval')} must be PT1M to P31D`);
          const n = leaf(count, problems, 'Count');
          if (!/^\d+$/.test(n) || Number(n) < 1 || Number(n) > 255) problems.push(`RestartOnFailure Count ${n} must be 1 to 255 (xs:unsignedByte)`);
        }
      }
      if (s.name === 'IdleSettings') once(s, ['Duration', 'WaitTimeout', 'StopOnIdleEnd', 'RestartOnIdle'], 'IdleSettings', problems);
    }
  }
  return problems;
}
