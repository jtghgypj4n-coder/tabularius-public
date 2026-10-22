// Get ( parameter ): the host answers what it knows; these defaults cover
// the clock, identifiers and fixed facts about Tabularius. In browser sessions,
// current* defaults read the server clock unless a host supplies a client clock
// through ctx.now. Layout {{CurrentDate}}/{{CurrentTime}} read the browser clock.

import { randomUUID } from 'node:crypto';
import { hostname, networkInterfaces, release } from 'node:os';
import type { Env } from './evaluate.ts';
import { EMPTY, num, text, timestampFromDate, dayNumber, type Value } from './values.ts';

function localParts(d: Date) {
  return { day: dayNumber(d.getFullYear(), d.getMonth() + 1, d.getDate()), seconds: d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds() };
}

const DEFAULTS: Record<string, (env: Env) => Value> = {
  currentdate: (env) => ({ type: 'date', value: localParts(now(env)).day }),
  currenttime: (env) => ({ type: 'time', value: localParts(now(env)).seconds }),
  currenttimestamp: (env) => {
    const p = localParts(now(env));
    return { type: 'timestamp', value: (p.day - 1) * 86400 + p.seconds };
  },
  currenthostdate: (env) => DEFAULTS.currentdate(env),
  currenthosttime: (env) => DEFAULTS.currenttime(env),
  currenthosttimestamp: (env) => DEFAULTS.currenttimestamp(env),
  currenttimeutcmilliseconds: (env) => num(Math.round(timestampFromDate(now(env).getTime()) * 1000)),
  currenttimeutcmicroseconds: (env) => num(Math.round(timestampFromDate(now(env).getTime()) * 1e6)),
  uuid: () => text(randomUUID().toUpperCase()),
  uuidnumber: () => {
    // 41 decimal digits like FileMaker's UUIDNumber: a random 128-bit value.
    const hex = randomUUID().replace(/-/g, '');
    return text(BigInt('0x' + hex).toString().padStart(41, '0'));
  },
  lasterror: () => num(0),
  lasterrordetail: () => EMPTY,
  lasterrorlocation: () => EMPTY,
  applicationversion: () => text('tabularius 0.1'),
  applicationlanguage: () => text('English'),
  systemplatform: () => num(process.platform === 'win32' ? -2 : process.platform === 'darwin' ? 1 : 5),
  systemlanguage: () => text('English'),
  // Empty, as FileMaker gives in WebDirect and on a Linux host.
  systemappearance: () => EMPTY,
  hostapplicationversion: () => text('tabularius 0.1'),
  persistentid: () => text('tabularius'),
  calculationrepetitionnumber: (env) => num(env.ctx.calculationRepetition ?? 1),
  activerepetitionnumber: () => num(1),
  activeportalrownumber: () => num(0),
  activemodifierkeys: () => num(0),
  // 0: unknown device, as for a server.
  device: () => num(0),
  scriptparameter: () => EMPTY,
  scriptresult: () => EMPTY,
  scriptname: () => EMPTY,
  documentspath: () => text('/'),
  temporarypath: () => text('/tmp/'),
  desktoppath: () => text('/'),
  preferencespath: () => text('/'),
  multiuserstate: () => num(2),
  networkprotocol: () => text('TCP/IP'),
  connectionstate: () => num(0),
  trigger: () => EMPTY,
  windowstyle: () => num(0),
  // States of things a person sees, as for a server with no window on a screen.
  errorcapturestate: () => num(0),
  allowabortstate: () => num(1),
  usesystemformatsstate: () => num(0),
  allowformattingbarstate: () => num(0),
  textrulervisible: () => num(0),
  statusareastate: () => num(0),
  menubarstate: () => num(0),
  touchkeyboardstate: () => num(0),
  guidedaccessstate: () => num(0),
  highcontraststate: () => num(0),
  scriptanimationstate: () => num(0),
  layoutviewstate: () => num(0),
  windowvisible: () => num(1),
  windowzoomlevel: () => num(100),
  windoworientation: () => num(0),
  windowheight: () => num(0), windowwidth: () => num(0), windowtop: () => num(0), windowleft: () => num(0),
  windowcontentheight: () => num(0), windowcontentwidth: () => num(0), windowdesktopheight: () => num(0), windowdesktopwidth: () => num(0),
  screenheight: () => num(0), screenwidth: () => num(0), screendepth: () => num(0), screenscalefactor: () => num(1),
  pagenumber: () => num(0),
  activeselectionsize: () => num(0),
  activeselectionstart: () => num(0),
  triggerkeystroke: () => EMPTY,
  triggermodifierkeys: () => num(0),
  triggergestureinfo: () => EMPTY,
  triggerexternalevent: () => EMPTY,
  laststeptokensused: () => num(0),
  // Empty where Claris says so: FileMaker Go's network and region monitoring, a printer (WebDirect has none), cache
  // files (none for server-side scripts or WebDirect), and the host's certificate (the host isn't FileMaker Server).
  networktype: () => EMPTY,
  regionmonitorevents: () => EMPTY,
  printername: () => EMPTY,
  cachefilename: () => EMPTY,
  cachefilepath: () => EMPTY,
  connectionattributes: () => EMPTY,
  // Group of an externally authenticated account; the host says when it knows one.
  accountgroupname: () => EMPTY,
  // Pages in the print job running; empty when nothing is printing.
  pagecount: () => EMPTY,
  // The host's plug-ins (packages/plugins): name;version;state, one per line.
  installedfmplugins: (env) => text((env.ctx.installedPlugins?.() ?? []).map((p) => `${p.name};${p.version};${p.state}`).join('\r')),
  installedfmpluginsasjson: (env) => {
    const plugins = env.ctx.installedPlugins?.() ?? [];
    return text(JSON.stringify({
      APIVers: 2,
      environment: { architecture: process.arch === 'x64' ? 'x86_64' : process.arch, platform: process.platform === 'win32' ? -2 : process.platform === 'darwin' ? 1 : 5, version: release() },
      plugins: plugins.length ? plugins.map((p) => ({ name: p.name, id: p.id, version: p.version, state: p.state, filepath: '', description: p.description ?? '' })) : null,
    }));
  },
  usercount: () => num(1),
  applicationarchitecture: () => text(process.arch === 'x64' ? 'x86_64' : process.arch),
  encryptionstate: () => num(0),
  hostname: () => text(hostname()),
  systemversion: () => text(release()),
  systemdrive: () => text('/'),
  filemakerpath: () => text('/'),
  // The machine's own addresses, as FileMaker Server reports its host's.
  hostipaddress: () => text(addresses()[0] ?? ''),
  systemipaddress: () => text(addresses().join('\r')),
  systemnicaddress: () => text([...new Set(Object.values(networkInterfaces()).flat().filter((x) => x && !x.internal && x.mac !== '00:00:00:00:00:00').map((x) => x!.mac))].join('\r')),
};

/** Lower-case Get parameter names the calculation engine answers on its own, when the host supplies nothing. */
export const GET_DEFAULT_NAMES: ReadonlySet<string> = new Set(Object.keys(DEFAULTS));

function addresses(): string[] {
  return Object.values(networkInterfaces()).flat().filter((x) => x && !x.internal && x.family === 'IPv4').map((x) => x!.address);
}

function now(env: Env): Date {
  return env.ctx.now?.() ?? new Date();
}

export function getParameter(param: string, env: Env): Value {
  if (/^⟨get:[a-f\d]{2}⟩$/i.test(param)) {
    env.ctx.notice?.(`Unknown Get option ${param}: skipped; returns ?`);
    return text('?');
  }
  const v = env.ctx.get?.(param);
  if (v !== undefined) return v;
  return DEFAULTS[param.toLowerCase()]?.(env) ?? EMPTY;
}
