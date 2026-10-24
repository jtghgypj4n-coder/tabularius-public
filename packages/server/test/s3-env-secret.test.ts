import { test } from 'node:test';
import assert from 'node:assert/strict';
import { s3FromEnv } from '../src/s3.ts';

const names = ['TABULARIUS_S3_ACCESS_KEY', 'TABULARIUS_S3_SECRET_KEY', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'];

test('an empty or blank S3 secret key is refused by name; unset still falls back to the AWS variable', (t) => {
  const saved = Object.fromEntries(names.map((n) => [n, process.env[n]]));
  t.after(() => { for (const n of names) { if (saved[n] === undefined) delete process.env[n]; else process.env[n] = saved[n]; } });
  for (const n of names) delete process.env[n];
  process.env.TABULARIUS_S3_ACCESS_KEY = 'id';
  process.env.AWS_SECRET_ACCESS_KEY = ['aws', 'fallback'].join('-');
  assert.equal(s3FromEnv('s3://bucket/p').secretKey, ['aws', 'fallback'].join('-'));
  for (const value of ['', '  ', '\t']) {
    process.env.TABULARIUS_S3_SECRET_KEY = value;
    assert.throws(() => s3FromEnv('s3://bucket/p'), /^Error: TABULARIUS_S3_SECRET_KEY is set but empty/, JSON.stringify(value));
  }
});
