import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NAME_LOOKUP, addressRefusal, classifyAddress, guardedLookup, hostRefusal, ipv6Groups, isInternalHost, isLoopbackAddress, mappedIPv4, parseAllowList, socketLookup } from '../src/net-guard.ts';

// These are the implemented outbound policy, not independently verified compatibility behavior.
test('address decisions include range endpoints, neighboring ranges and embedded IPv4', () => {
  const cases = {
    never: ['0.0.0.0', '0.1.2.3', '169.254.0.1', '100.100.100.200', '168.63.129.16', '224.0.0.0', '255.255.255.255', '::', 'fe80::1', 'febf::1', 'ff00::1', 'fd00:ec2::254', 'fd20:ce::254', 'bad'],
    own: ['127.0.0.1', '10.0.0.1', '172.16.0.1', '172.31.0.1', '192.168.0.1', '100.64.0.1', '100.127.0.1', '100.100.99.200', '100.100.100.201', '192.0.0.1', '198.18.0.1', '198.19.0.1', '::1', '64:ff9b:1::1', '2001::1', 'fc00::1', 'fdff::1', 'fec0::1', 'fd20:cf::1'],
    public: ['1.0.0.0', '223.255.255.255', '169.253.0.1', '168.63.129.15', '172.15.0.1', '172.32.0.1', '192.167.0.1', '100.63.0.1', '100.128.0.1', '192.0.1.1', '198.17.0.1', '198.20.0.1', '2001:db8::1', 'fe7f::1', '64:ff9b:2::1'],
  } as const;
  for (const [expected, addresses] of Object.entries(cases)) for (const address of addresses) {
    assert.equal(classifyAddress(address), expected, address);
    if (/^\d+\./.test(address)) {
      const octets = address.split('.').map(Number);
      const pair = `${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
      for (const embedded of [`::ffff:${address}`, `::ffff:${pair}`, `64:ff9b::${pair}`, `2002:${pair}::1`]) {
        assert.equal(classifyAddress(embedded), expected, embedded);
      }
    }
  }
  for (const ip of ['127.0.0.1', '127.255.255.255', '::1', '::ffff:7f00:1', '::127.0.0.1', '64:ff9b::7f00:1', '2002:7f00:1::']) assert.equal(isLoopbackAddress(ip), true, ip);
  for (const ip of ['10.0.0.1', '128.0.0.1', '::', '2001:db8::1', 'bad']) assert.equal(isLoopbackAddress(ip), false, ip);
});

test('exported address parsers preserve valid groups and reject malformed addresses', () => {
  assert.equal(mappedIPv4('::ffff:192.0.2.1'), '192.0.2.1');
  assert.equal(mappedIPv4('::ffff:c000:201'), '192.0.2.1');
  assert.equal(mappedIPv4('::1'), undefined);
  assert.equal(ipv6Groups('bad'), undefined);
  assert.deepEqual(ipv6Groups('[2001:DB8::1]'), [0x2001, 0xdb8, 0, 0, 0, 0, 0, 1]);
  assert.deepEqual(ipv6Groups('1:2:3:4:5:6:7:8'), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(ipv6Groups('::ffff:192.0.2.1'), [0, 0, 0, 0, 0, 0xffff, 0xc000, 0x201]);
  assert.deepEqual(ipv6Groups('fe80::1%eth0'), [0xfe80, 0, 0, 0, 0, 0, 0, 1]);
});

test('metadata always refuses, own addresses need policy, public addresses pass', () => {
  for (const host of ['metadata', 'METADATA.GOOGLE.INTERNAL.', 'instance-data', 'metadata.goog', 'instance-data.ec2.internal']) {
    assert.equal(isInternalHost(host), true);
    assert.match(hostRefusal({ private: true }, host)!, /link-local/);
    assert.match(addressRefusal({ private: true }, host, '192.0.2.1')!, /link-local/);
  }
  for (const ip of ['169.254.0.1', '100.100.100.200', '168.63.129.16', 'fe80::1', 'fd00:ec2::254', 'fd20:ce::254', '::ffff:a9fe:1']) {
    assert.equal(isInternalHost(ip), true);
    assert.match(addressRefusal({ private: true }, 'host.test', ip)!, /link-local/, ip);
  }
  for (const ip of ['0.0.0.0', '224.0.0.1', '::', 'ff02::1']) assert.match(addressRefusal({}, ip, ip)!, /unspecified, multicast or reserved/);
  for (const ip of ['127.0.0.1', 'fd01::1', '10.0.0.1']) {
    assert.equal(isInternalHost(ip), false);
    assert.match(addressRefusal({}, ip, ip)!, /own network/);
    assert.equal(addressRefusal({ private: true }, ip, ip), undefined);
  }
  assert.equal(isInternalHost('ordinary.test'), false);
  assert.equal(hostRefusal({}, 'ordinary.test'), undefined);
  assert.equal(hostRefusal({}, '192.0.2.1'), undefined);
  assert.equal(addressRefusal({}, 'ordinary.test', '192.0.2.1'), undefined);
});

test('allow lists enforce exact hosts, suffixes, address families and CIDR boundaries', () => {
  const policy = { private: [' Listed.Test. ', '*.corp.test', '10.8.0.0/16', '[fd00:abcd::]/32', '::1', '127.0.0.2', ' '] };
  for (const [host, ip, allowed] of [
    ['listed.test', '10.9.0.1', true], ['other.test', '10.9.0.1', false],
    ['a.corp.test', '10.9.0.1', true], ['corp.test', '10.9.0.1', false], ['evilcorp.test', '10.9.0.1', false],
    ['host.test', '10.8.255.255', true], ['host.test', '10.9.0.0', false],
    ['host.test', '::ffff:a08:1', true], ['host.test', '::ffff:a09:1', false],
    ['host.test', 'fd00:abcd:ffff::1', true], ['host.test', 'fd00:abce::1', false],
    ['host.test', '::1', true], ['host.test', '127.0.0.2', true], ['host.test', '127.0.0.3', false],
  ] as const) assert.equal(addressRefusal(policy, host, ip) === undefined, allowed, `${host} ${ip}`);
  assert.equal(addressRefusal({ private: ['0.0.0.0/0'] }, 'host.test', '10.0.0.1'), undefined);
  assert.equal(addressRefusal({ private: ['::/0'] }, 'host.test', 'fd00::1'), undefined);
  for (const bad of ['10.0.0.0/33', '::/129', '::/-1', '::/x', '::/1/2', 'host.test/2', '10.1', 'http://host.test', '*', 'a b']) assert.throws(() => parseAllowList([bad]), Error, bad);
  assert.deepEqual(parseAllowList(['host.test', '*.corp.test']), [{ host: 'host.test' }, { suffix: '.corp.test' }]);
});

test('socket lookup refuses any forbidden answer before filtering families and returns checked addresses', async (t) => {
  let answers: { address: string; family?: number }[] = [];
  const failure = new Error('synthetic resolver failure');
  let fail = false;
  t.mock.method(NAME_LOOKUP, 'lookup', async () => { if (fail) throw failure; return answers; });
  const lookup = (host: string, options: { family?: number | string; all?: boolean } = {}) => new Promise<{ error: NodeJS.ErrnoException | null; address: unknown; family: unknown }>((resolve) => {
    guardedLookup()(host, options, (error, address, family) => resolve({ error, address, family }));
  });
  answers = [{ address: '192.0.2.1' }, { address: '2001:db8::1', family: 6 }];
  for (const family of [4, 'IPv4']) assert.deepEqual(await lookup('host.test', { family }), { error: null, address: '192.0.2.1', family: 4 });
  for (const family of [6, 'IPv6']) assert.deepEqual(await lookup('host.test', { family }), { error: null, address: '2001:db8::1', family: 6 });
  assert.deepEqual((await lookup('host.test', { all: true, family: 4 })).address, [{ address: '192.0.2.1', family: 4 }]);
  assert.deepEqual((await lookup('host.test', { all: true })).address, [{ address: '192.0.2.1', family: 4 }, { address: '2001:db8::1', family: 6 }]);
  assert.deepEqual(await lookup('192.0.2.2'), { error: null, address: '192.0.2.2', family: 4 });
  answers.push({ address: '::1', family: 6 });
  assert.equal((await lookup('host.test', { family: 4 })).error?.code, 'EOUTBOUND');
  answers = [];
  assert.equal((await lookup('host.test')).error?.code, 'ENOTFOUND');
  fail = true;
  assert.equal((await lookup('host.test')).error, failure);
  await new Promise<void>((resolve) => guardedLookup()('192.0.2.3', (error, address, family) => {
    assert.equal(error, null); assert.equal(address, '192.0.2.3'); assert.equal(family, 4); resolve();
  }));
  assert.equal(typeof socketLookup(), 'function');
});

test('remaining address boundaries distinguish invalid groups, metadata lookalikes and family-only allow lists', async (t) => {
  assert.equal(ipv6Groups('1:2:3:4:5:6:7:00001'), undefined);
  for (const ip of ['65:ff9b:1::1', '64:ffaa:1::1']) assert.equal(classifyAddress(ip), 'public', ip);
  for (const ip of ['0.254.0.1', 'ff02:ec2::1', 'ff02:ce::1']) assert.match(addressRefusal({}, ip, ip)!, /unspecified, multicast or reserved/, ip);
  assert.equal(addressRefusal({ private: ['::ffff:0:0/96'] }, 'host.test', '::ffff:a01:1'), undefined);
  assert.match(addressRefusal({ private: ['::/0'] }, 'host.test', '10.1.0.1')!, /own network/);
  assert.match(addressRefusal({ private: ['0.0.0.0/0'] }, 'host.test', 'fd00::1')!, /own network/);
  assert.match(hostRefusal({}, '127.0.0.1')!, /own network/);
  t.mock.method(NAME_LOOKUP, 'lookup', async () => [{ address: '2001:db8::1', family: 6 }]);
  await new Promise<void>((resolve) => guardedLookup()('host.test', {}, (error, address, family) => {
    assert.equal(error, null); assert.equal(address, '2001:db8::1'); assert.equal(family, 6); resolve();
  }));
});
