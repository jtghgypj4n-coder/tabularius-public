import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { conversionTemp, stageConversionSource, publishConversion, completeConversionSource, finishConversion } from '../src/conversion-files.ts';

test('AR-fmp12-reader-08', () => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'tabularius-source-identity-'));
  try {
    const upload = join(dir, 'upload.part');
    const store = join(dir, 'Events.openhbam.sqlite');
    const target = join(dir, 'Events.fmp12');
    fs.writeFileSync(upload, 'BBBB');
    fs.writeFileSync(target, 'AAAA');
    const temp = conversionTemp(store, upload);
    fs.writeFileSync(temp, 'synthetic store B');
    const staged = join(dirname(temp), 'source.fmp12');
    fs.writeFileSync(staged, 'CCCC');
    stageConversionSource(temp, upload);
    assert.equal(fs.readFileSync(staged, 'utf8'), 'BBBB');
    assert.equal(publishConversion(temp, store), true);
    completeConversionSource(temp, store);
    finishConversion(temp);
    assert.equal(fs.readFileSync(target, 'utf8'), 'BBBB');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
