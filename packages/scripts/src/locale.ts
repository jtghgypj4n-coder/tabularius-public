// Get ( FileLocaleElements ) and Get ( SystemLocaleElements ): FileMaker's
// JSON description of a locale (APIVers 1). Tabularius formats in English with
// the file's date order, so both describe that. The keys follow the example
// on Claris's help page for the functions; the long date element order for
// English is inferred from FileMaker's "Thursday, October 12, 2026" style.

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const ELEMENTS: Record<string, { NameList: string[]; SepList: string[] }> = {
  MDY: { NameList: ['D$', 'M$', 'D#', 'YYYY#'], SepList: [', ', ' ', ', ', ''] },
  DMY: { NameList: ['D$', 'D#', 'M$', 'YYYY#'], SepList: [', ', ' ', ' ', ''] },
  YMD: { NameList: ['YYYY#', 'M$', 'D#', 'D$'], SepList: [' ', ' ', ', ', ''] },
  ISO: { NameList: ['YYYY#', 'M#', 'D#'], SepList: ['-', '-', ''] },
};

/** The locale as FileMaker's JSON; `active` is Misc.Active (the file's locale is the one in use). */
export function localeElements(style: string | { order: string; padded?: boolean }, active: boolean): string {
  const dateOrder = typeof style === 'string' ? style : style.order;
  const iso = dateOrder === 'ISO';
  const padded = iso || typeof style !== 'string' && !!style.padded;
  const order = ELEMENTS[dateOrder] ? dateOrder : 'MDY';
  return JSON.stringify({
    APIVers: 1,
    Currency: { Leading: true, Symbol: '$' },
    Date: {
      DMQ: {
        '1stDayOfWeek': 1,
        DaysOfWeek: { AbbrvList: DAYS.map((d) => d.slice(0, 3)), NameList: DAYS },
        Months: { AbbrvList: MONTHS.map((m) => m.slice(0, 3)), NameList: MONTHS },
        Quarters: { AbbrvList: ['Q1', 'Q2', 'Q3', 'Q4'], NameList: ['1st Quarter', '2nd Quarter', '3rd Quarter', '4th Quarter'] },
      },
      DMY: { ElementArray: ELEMENTS[order], MustUseLocalesSep: false },
      DateNums: { '0d': padded, '0m': padded, YYyy: false },
      DateOrderID: { MDY: 0, DMY: 1, YMD: 2, ISO: 2 }[order],
      DateOrderName: order,
      Sep: iso ? '-' : '/',
    },
    LocaleID: { IDNum: 1, IDStr: 'English', ISOLangCode: 'en', LID: 'English', Name: 'English' },
    Misc: { Active: active, Metric: false },
    Num: { '1000s': ',', Decimal: '.', Lead0: true },
    Text: { SQuotLead: '‘', SQuotTrail: '’', Sep: ',' },
    Time: { '12h': !iso, HMS: { '0h': iso, '24h': '', Seconds: true }, NightDay: { '12hSuffix': !iso, amStr: 'AM', pmStr: 'PM' }, Sep: ':' },
  });
}
