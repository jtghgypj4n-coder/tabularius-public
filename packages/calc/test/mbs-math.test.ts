// MBS ( "Math.…" ) and ( "Time.…" ) against the examples on MBS's own function pages (mbsplugins.eu). Their
// results were made in Germany (Central European time), so the time zone is set to match.
process.env.TZ = 'Europe/Berlin';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateText, type CalcContext } from '../src/index.ts';
import { MBS_MATH } from '../src/mbs-math.ts';
import { MbsError } from '../src/mbs-text.ts';
import { num, text, type Value } from '../src/values.ts';

const now = () => new Date('2016-12-11T10:36:44Z');
const m = (name: string, ...args: (string | number | Value)[]) => {
  const values = args.map((a) => (typeof a === 'number' ? num(a) : typeof a === 'string' ? text(a) : a));
  const r = MBS_MATH[name.toLowerCase()]({ values, texts: values.map((v) => String(v.value)), now });
  return r.type === 'number' ? r.value : r.value;
};
/** FileMaker seconds for a local date and time (a timestamp value). */
const ts = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0): Value =>
  ({ type: 'timestamp', value: Date.UTC(y, mo - 1, d, h, mi, s) / 1000 + 719162 * 86400 });
const date = (y: number, mo: number, d: number): Value => ({ type: 'date', value: Date.UTC(y, mo - 1, d) / 86400000 + 719163 });
const close = (got: unknown, want: number, places = 9) => assert.ok(Math.abs(Number(got) - want) < 10 ** -places, `${got} ≈ ${want}`);

test('MBS Math: sums, averages and spreads of values and lists', () => {
  assert.equal(m('Math.Sum', 1, 2, 4), 7);
  assert.equal(m('Math.Sum', '1\r2\r4', 5), 12);
  assert.equal(m('Math.Average', '1\r6\r4', '7\r8'), 5.2);
  assert.equal(m('Math.Average', 3, 4, 8), 5);
  assert.equal(m('Math.Min', '1\r6\r4'), 1);
  assert.equal(m('Math.Max', '1\r6\r4'), 6);
  assert.equal(m('Math.Sum'), '');
  close(m('Math.StandardDeviation', '12.5 \r7\r10\r7.8 \r15.5 '), 3.1232034836046147497, 12);
  assert.equal(m('Math.StandardDeviation', 1), 0);
  assert.equal(m('Math.Multiply', '3\r4\r5', 2), '6\r8\r10');
  assert.equal(m('Math.Multiply', '3\r4\r5', '1\r2\r3'), '3\r8\r15');
  assert.equal(m('Math.Reciprocal', '3\r4\r5\r0'), '0.3333333333333333\r0.25\r0.2\r0');
  assert.throws(() => m('Math.Sum', 'x'), MbsError);
});

test('MBS Math: moving averages, as the page lists them', () => {
  const input = '100.99 ¶101.75 ¶103.02 ¶104.43 ¶102.77 ¶101.79 ¶100.93 ¶99.08 ¶99.24 ¶100.21'.replace(/ ¶/g, '\r');
  const check = (mode: string, want: number[]) => String(m('Math.MovingAverage', mode, input, 5)).split('\r').forEach((v, i) => close(v, want[i], 9));
  check('simple', [100.99, 101.37, 101.92, 102.5475, 102.592, 102.752, 102.588, 101.8, 100.762, 100.25]);
  check('weighted', [100.99, 101.4966666666666667, 102.2583333333333333, 103.127, 103.008, 102.7406666666666667, 102.1333333333333333, 100.964, 100.1106666666666667, 99.9266666666666667]);
  check('Exponential', [100.99, 101.294, 101.9844, 102.96264, 102.885584, 102.4473504, 101.84041024, 100.736246144, 100.1377476864, 100.16664861184]);
  assert.throws(() => m('Math.MovingAverage', 'odd', input, 5), /Unknown mode/);
});

test('MBS Math: bits, hex and binary numbers', () => {
  assert.equal(m('Math.BitwiseAND', 255, 48, 18), 16);
  assert.equal(m('Math.BitwiseOR', 5, 6, 16), 23);
  assert.equal(m('Math.BitwiseXOR', 5, 6, 16), 19);
  assert.equal(m('Math.BitwiseNOT', 255), -256);
  assert.equal(m('Math.BitwiseShiftLeft', 4, 2), 16);
  assert.equal(m('Math.BitwiseShiftRight', 16, 2), 4);
  assert.equal(m('Math.BitwiseRotate', 123, 1), 246);
  assert.equal(m('Math.BitwiseRotate', 128, -1), 64);
  assert.equal([0, 1, 2, 3, 4, 5, 6, 7].map((b) => m('Math.GetBit', 123, b)).join(''), '11011110');
  assert.equal(m('Math.SetBit', 0, 0), 1);
  assert.equal(m('Math.SetBit', 0, 63), '9223372036854775808');
  assert.equal(m('Math.ClearBit', 5, 0), 4);
  assert.equal(m('Math.ClearBit', 5, 1), 5);
  assert.equal(m('Math.ClearBit', 5, 2), 1);
  assert.equal(m('Math.SetBit', 16, 5), 48);
  assert.throws(() => m('Math.GetBit', 1, 64), /0 to 63/);
  assert.equal(m('Math.DecToHex', 65535), '0000FFFF');
  assert.equal(m('Math.DecToHex', 4096, 1), '1000');
  assert.equal(m('Math.HexToDec', 'FFFF'), 65535);
  assert.equal(m('Math.EncodeNumber', 'Float', 32, 123.456), '79E9F642');
  assert.equal(m('Math.EncodeNumber', 'Integer', 8, -56), 'C8');
  assert.equal(m('Math.EncodeNumber', 'UnsignedInteger', 64, 1234567890123456), 'C0BA8A3CD5620400');
  close(m('Math.DecodeNumber', 'Float', 32, '79E9F642'), 123.456, 4);
  assert.equal(m('Math.DecodeNumber', 'Integer', 8, 'C8'), -56);
  assert.equal(m('Math.DecodeNumber', 'UnsignedInteger', 64, 'C0BA8A3CD5620400'), 1234567890123456);
  assert.equal(m('Math.DecodeNumber', 'Integer', 64, '0000000000000001', 1), 1);
  assert.throws(() => m('Math.EncodeNumber', 'Integer', 8, 300), /doesn't fit/);
});

test('MBS Math: units, polylines, card numbers and formatting', () => {
  assert.equal(m('Math.PixelToMillimeter', 72, 72), 25.4);
  assert.equal(m('Math.InchToPixel', 3), 216);
  assert.equal(m('Math.PolylineEncode', 38.5), '_p~iF');
  assert.equal(m('Math.PolylineEncode', -120.2), '~ps|U');
  assert.equal([38.5, -120.2, 40.7 - 38.5, -120.95 - -120.2, 43.252 - 40.7, -126.453 - -120.95].map((v) => m('Math.PolylineEncode', v)).join(''), '_p~iF~ps|U_ulLnnqC_mqNvxq`@');
  assert.equal(m('Math.PolylineDecode', '~ps|U'), -120.2);
  assert.equal(m('Math.IsValidCC', '4111 1111 1111 1111'), 1);
  assert.equal(m('Math.IsValidCC', '4111 1111 1111 1112'), 0);
  assert.equal(m('Math.FormatNumber', 123), '123');
  assert.equal(m('Math.FormatNumber', 12.34, 2, ','), '12,34');
  assert.equal(m('Math.FormatNumber', 0.001, 3, ''), '0.001');
  assert.equal(m('Math.FormatNumber', 123456789.1235, 3, '', '.'), '123,456,789.124');
  assert.equal(m('Math.FormatNumber', -123456789.1235, 3, '', '.'), '-123,456,789.124');
  assert.equal(m('Math.FormatNumber', '1234567890123456789012345678901234567890.1234567890', 8, ',', '.'), '1.234.567.890.123.456.789.012.345.678.901.234.567.890,12345679');
  assert.equal(m('Math.FormatNumber', 12.3456, 3, '.', ''), '12.346');
  assert.equal(m('Math.FormatNumber', 12.3456, 12, '.', ''), '12.345600000000');
  assert.equal(m('Math.FormatNumber', 12.3456, 20, '.', ''), '12.34560000000000000000');
  assert.equal(m('Math.FormatNumber', 0.995, 2), '1.00');
  assert.equal(m('Math.NumberToText', 1234.5), '1234.5');
});

test('MBS Math: NormInv and Rate, as Excel', () => {
  close(m('Math.NormInv', 0.56, 5, 2), 5.3019384309935544408, 12);
  close(m('Math.NormInv', 0.975, 0, 1), 1.959963984540054, 12);
  assert.throws(() => m('Math.NormInv', 0.5), /mean/);
  // Excel's own example: 4 years at 200 a month on 8000 is about 0.77% a month.
  close(m('Math.Rate', 48, -200, 8000), 0.007701472488, 9);
  assert.throws(() => m('Math.Rate', 10, 100, 1000), /converge/);
});

test('MBS Time: Unix times, UTC and the zone, as the pages show (Central European time)', () => {
  assert.equal(m('Time.UnixTimeStamp', date(1956, 5, 5), 0), -431053200);
  assert.equal(m('Time.UnixTimeStamp', date(1956, 5, 5), 1), -431049600);
  assert.equal(m('Time.UnixTimeStamp', ts(2016, 12, 11, 11, 37, 6)), 1481452626);
  assert.equal(m('Time.UnixTimeStamp'), 1481452604);
  assert.deepEqual(m('Time.UnixTimeStampToFileMaker', 1527786192), ts(2018, 5, 31, 19, 3, 12).value);
  assert.equal(m('Time.UnixTimeStampToFileMaker', 1527786192, 1), ts(2018, 5, 31, 17, 3, 12).value);
  assert.equal(m('Time.TimeStampToUTC', ts(2016, 12, 11, 11, 36, 44)), ts(2016, 12, 11, 10, 36, 44).value);
  assert.equal(m('Time.TimeStampToUTC', ts(2016, 12, 11, 11, 36, 50), 1), '2016-12-11T10:36:50Z');
  assert.equal(m('Time.TimeZoneOffset', 1), '+01:00');
  assert.equal(m('Time.TimeZoneOffset', 0), 3600);
});

test('MBS Time: Format and Parse, with names in the locale asked for', () => {
  const t = ts(2016, 12, 11, 11, 36, 18);
  assert.equal(m('Time.Format', t, '%d %B %Y'), '11 December 2016');
  assert.equal(m('Time.Format', t, '%d %B %Y', 'FR_fr'), '11 décembre 2016');
  assert.equal(m('Time.Format', t, '%Y-%m-%d %H:%M:%S'), '2016-12-11 11:36:18');
  assert.equal(m('Time.Format', t, '%a, %d %b %Y %H:%M:%S %z'), 'Sun, 11 Dec 2016 11:36:18 +0100');
  assert.equal(m('Time.Format', t, '%j %U %W %V %u %w %I %p %e'), '346 50 49 49 7 0 11 AM 11');
  assert.equal(m('Time.Format', '', '%Y'), '');
  assert.equal(m('Time.Parse', '2016-11-30', '%Y-%m-%d'), ts(2016, 11, 30).value);
  assert.equal(m('Time.Parse', '2016-11-30 13:31', '%Y-%m-%d %H:%M'), ts(2016, 11, 30, 13, 31).value);
  assert.equal(m('Time.Parse', '30 novembre 16 1:05 pm', '%d %B %y %I:%M %p', 'fr_FR'), ts(2016, 11, 30, 13, 5).value);
  assert.throws(() => m('Time.Parse', '2016-02-30', '%Y-%m-%d'), /doesn't match/);
  assert.throws(() => m('Time.Parse', '13:31', '%H:%M'), /needs a year/);
});

test('MBS Math through MBS ( … ): numbers come back as numbers, errors set IsError', () => {
  const c: CalcContext = {};
  assert.equal(evaluateText('MBS ( "Math.Sum" ; 1 ; 2 ; 4 ) + 1', c), '8');
  assert.equal(evaluateText('MBS ( "Math.Median" ; 1 )', c).startsWith('[MBS] ERROR'), true);
  assert.match(evaluateText('MBS ( "Math.HexToDec" ; "XYZ" )', c), /^\[MBS\] ERROR/);
  assert.equal(evaluateText('MBS ( "IsError" )', c), '1');
  assert.equal(evaluateText('GetAsText ( MBS ( "Time.Parse" ; "2016-11-30" ; "%Y-%m-%d" ) )', c), '11/30/2016 0:00:00');
});

test('MBS Math and Time: long, huge and out-of-range input gives an answer or an MBS error quickly', () => {
  const quick = (f: () => unknown, ms = 1500) => {
    const t0 = Date.now();
    try {
      f();
    } catch (e) {
      assert.ok(e instanceof MbsError, String(e));
    }
    assert.ok(Date.now() - t0 < ms, `took ${Date.now() - t0} ms`);
  };
  quick(() => m('Math.Sum', '1'.repeat(200000) + 'x'));
  quick(() => m('Math.FormatNumber', '1e60000', 0, '.', ','));
  quick(() => m('Math.FormatNumber', '1e400000000', 2));
  assert.throws(() => m('Math.FormatNumber', '1e401', 0), MbsError);
  assert.equal(m('Math.FormatNumber', '1234567', 0, '.', ','), '1,234,567');
  assert.equal(m('Math.FormatNumber', '-123456.5', 0, '.', ','), '-123,457');
  const many = Array.from({ length: 200000 }, (_, i) => String(i % 1000)).join('\r');
  assert.equal(m('Math.Min', many), 0);
  assert.equal(m('Math.Max', many), 999);
  quick(() => m('Math.MovingAverage', 'Weighted', many, 100000));
  quick(() => m('Time.Format', ts(2016, 12, 11), '%Z%c%x'.repeat(30000), 'de_DE'));
  quick(() => m('Time.Parse', 'Sun'.repeat(40000), '%a'.repeat(40000)));
  assert.throws(() => m('Time.UnixTimeStampToFileMaker', '1e20'), MbsError);
  assert.throws(() => m('Time.UnixTimeStampToFileMaker', '1e20', 1), MbsError);
  assert.throws(() => m('Time.Format', { type: 'timestamp', value: 1e18 }, '%Y'), MbsError);
  assert.throws(() => m('Time.UnixTimeStamp', { type: 'timestamp', value: 1e18 }, 1), MbsError);
  assert.throws(() => m('Math.BitwiseShiftLeft', '1e400', 1), /too large for a 64-bit/);
  assert.throws(() => m('Math.EncodeNumber', 'Integer', -8, 1), /8, 16, 24, 32 or 64 bits/);
  assert.equal(m('Time.Format', ts(2016, 12, 11), '%B', 'de_DE@euro'), 'Dezember');
});

test('MBS Math: Rate solves a 30-year loan, and moving averages stay right past the window', () => {
  close(m('Math.Rate', 360, -1000, 150000), 0.0058503, 6);
  const v = '1\r2\r3\r4\r5\r6';
  assert.equal(m('Math.MovingAverage', 'Simple', v, 3), '1\r1.5\r2\r3\r4\r5');
  // Weighted over the last three: (1·a + 2·b + 3·c) / 6.
  String(m('Math.MovingAverage', 'Weighted', v, 3)).split('\r').forEach((x, i) => close(x, [1, 5 / 3, 14 / 6, 20 / 6, 26 / 6, 32 / 6][i], 12));
});

test('MBS Math: Poisson draws keep their mean past e^-m underflow; polylines past ±10737 don\'t wrap', () => {
  let total = 0;
  for (let i = 0; i < 400; i++) total += Number(m('Math.Random.PoissonDistribution', 1000));
  assert.ok(Math.abs(total / 400 - 1000) < 10, `mean ${total / 400}`);
  assert.equal(m('Math.PolylineDecode', m('Math.PolylineEncode', 30000)), 30000);
  assert.equal(m('Math.PolylineDecode', m('Math.PolylineEncode', -38.5)), -38.5);
});

test('MBS Time: years before 100 stay themselves', () => {
  // FileMaker seconds for 1 March 50 and 1 January 99 (days from 1/1/0001, counted without Date.UTC's 1900 shift).
  const day = (y: number, mo: number, d: number) => {
    const x = new Date(0);
    x.setUTCFullYear(y, mo - 1, d);
    return x.getTime() / 1000 + 719162 * 86400;
  };
  assert.equal(m('Time.Format', { type: 'timestamp', value: day(50, 3, 1) }, '%a %j %Y'), 'Tue 060 50');
  assert.equal(m('Time.Parse', '0099-01-01', '%Y-%m-%d'), day(99, 1, 1));
});
