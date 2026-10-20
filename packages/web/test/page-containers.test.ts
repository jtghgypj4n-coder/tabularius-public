import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sameOriginContainers } from '../src/layout.ts';

test('page calls: container links are pointed at the window\'s address, nothing else is touched', () => {
  const origin = 'https://files.example.com';
  const link = 'http://127.0.0.1:8080/tabularius/containers/Desk/7/a%20b.png?sig=abc&exp=99';
  assert.deepEqual(
    sameOriginContainers({ data: [{ fieldData: { Photo: link, Note: 'see http://127.0.0.1:8080/tabularius/containers/x', Site: 'https://elsewhere.test/tabularius/other/1', Count: 3 } }], ok: true }, origin),
    { data: [{ fieldData: { Photo: `${origin}/tabularius/containers/Desk/7/a%20b.png?sig=abc&exp=99`, Note: 'see http://127.0.0.1:8080/tabularius/containers/x', Site: 'https://elsewhere.test/tabularius/other/1', Count: 3 } }], ok: true },
  );
  assert.equal(sameOriginContainers(null, origin), null);
  assert.equal(sameOriginContainers(link, origin), `${origin}/tabularius/containers/Desk/7/a%20b.png?sig=abc&exp=99`);
});
