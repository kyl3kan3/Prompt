import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedLocalRequest } from '../src/server/local-request.ts';

const valid = { host: '127.0.0.1:3777', origin: 'http://127.0.0.1:3777', method: 'POST', localPort: 3777, fetchSite: 'same-origin' };
test('same-origin local browser mutations remain usable', () => {
  assert.equal(isAllowedLocalRequest(valid), true);
  assert.equal(isAllowedLocalRequest({ ...valid, host: 'localhost:3777', origin: 'http://localhost:3777' }), true);
});
test('simple-form cross-origin and missing-origin approvals are rejected', () => {
  for (const origin of [undefined, 'null', 'https://attacker.example', 'http://127.0.0.1:4000']) {
    assert.equal(isAllowedLocalRequest({ ...valid, origin }), false);
  }
  assert.equal(isAllowedLocalRequest({ ...valid, fetchSite: 'cross-site' }), false);
});
test('DNS-rebinding hosts and incorrect listener ports are rejected for reads too', () => {
  for (const host of ['attacker.example:3777', '127.0.0.1:80', '127.0.0.1:3777.attacker.example']) {
    assert.equal(isAllowedLocalRequest({ ...valid, method: 'GET', host }), false);
  }
  assert.equal(isAllowedLocalRequest({ ...valid, method: 'GET', origin: undefined, fetchSite: 'none' }), true);
});
