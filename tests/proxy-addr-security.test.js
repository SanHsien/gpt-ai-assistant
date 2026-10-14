import { expect, test } from '@jest/globals';
import { createRequire } from 'node:module';

// Resolve from Express, not an unrelated top-level installation.
const projectRequire = createRequire(`${process.cwd()}/package.json`);
const expressRequire = createRequire(projectRequire.resolve('express/package.json'));
const proxyaddr = expressRequire('proxy-addr');
const express = projectRequire('express');
const getExpressIp = Object.getOwnPropertyDescriptor(express.request, 'ip').get;
const socketAddress = '203.0.113.9';
const fakeClient = '198.51.100.17';
const request = (app, remoteAddress = socketAddress) => ({
  app, socket: { remoteAddress }, headers: { 'x-forwarded-for': fakeClient },
});

for (const subnet of ['::ffff:10.0.0.0/8', '::/1']) {
  for (const multi of [false, true]) {
    test(`rejects IPv4 spoofing for ${subnet}, trustMulti=${multi}`, () => {
      const ranges = multi ? [subnet, '192.0.2.0/24'] : subnet;
      let trust;
      try {
        trust = proxyaddr.compile(ranges);
      } catch (error) {
        // The official patch may reject an invalid mapped CIDR at configuration time.
        // Valid native IPv6 ::/1 must still compile; arbitrary errors never count as PASS.
        expect(subnet).toBe('::ffff:10.0.0.0/8');
        expect(error).toBeInstanceOf(TypeError);
        expect(error.message).toMatch(/invalid (range|IP)/i);
        console.log(JSON.stringify({ subnet, multi, result: 'invalid-subnet-rejected' }));
        return;
      }
      const app = express();
      app.set('trust proxy', trust);
      const predicate = trust(socketAddress);
      const forwarded = proxyaddr(request(app), trust);
      const expressIp = getExpressIp.call(request(app));
      console.log(JSON.stringify({ subnet, multi, predicate, forwarded, expressIp }));
      expect(predicate).toBe(false);
      expect(trust('::ffff:203.0.113.9')).toBe(false);
      expect(forwarded).toBe(socketAddress);
      expect(expressIp).toBe(socketAddress);
    });
  }
}

for (const subnet of ['10.0.0.0/8', '::ffff:10.0.0.0/104']) {
  for (const multi of [false, true]) {
    test(`preserves valid IPv4 and mapped IPv6 trust for ${subnet}, trustMulti=${multi}`, () => {
      const trust = proxyaddr.compile(multi ? [subnet, '192.0.2.0/24'] : subnet);
      expect(trust('10.1.2.3')).toBe(true);
      expect(trust('::ffff:10.1.2.3')).toBe(true);
      expect(trust(socketAddress)).toBe(false);
      const app = express();
      app.set('trust proxy', trust);
      expect(proxyaddr(request(app, '10.1.2.3'), trust)).toBe(fakeClient);
      expect(getExpressIp.call(request(app, '::ffff:10.1.2.3'))).toBe(fakeClient);
    });
  }
}

test('preserves native IPv6 subnet semantics without trusting IPv4', () => {
  for (const ranges of ['2001:db8::/32', ['2001:db8::/32', '192.0.2.0/24']]) {
    const trust = proxyaddr.compile(ranges);
    expect(trust('2001:db8::123')).toBe(true);
    expect(trust('2001:db9::123')).toBe(false);
    expect(trust(socketAddress)).toBe(false);
    const app = express();
    app.set('trust proxy', trust);
    expect(getExpressIp.call(request(app, '2001:db8::123'))).toBe(fakeClient);
  }
  expect(proxyaddr.compile('::/1')('::2')).toBe(true);
});
