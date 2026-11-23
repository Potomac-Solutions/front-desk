// The public demo: the seeded businesses, with each one's sign-ins shown on its pages and
// protected from change, and a reset once a night.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.js';
import { DEMO, nightly } from '../src/demo.js';
import { STAFF_COST } from './helpers.js';

const dir = mkdtempSync(join(tmpdir(), 'front-desk-demo-'));
let server;
let salon;
let fire;

// What `bin/seed.js` does for the sign-ins: each business's owner and staff, and the customer.
async function people(id, logins) {
  const { staff, customers } = await server.business(id);
  await staff.accept((await server.open()).find((link) => link.tenant.id === id).token, logins.owner);
  const owner = staff.list().find((one) => one.email === logins.owner.email);
  await staff.accept((await staff.invite(owner, { email: logins.staff.email, name: logins.staff.name, roles: ['staff'] })).token, logins.staff);
  await customers.signUp(DEMO.customer);
}

before(async () => {
  server = await createApp({
    tenants: [
      { id: 'yough-valley-hair', site: 'desk', hosts: ['localhost'] },
      { id: 'pine-hollow-vfc', site: 'community', hosts: ['127.0.0.1'] },
    ],
    dataDir: dir,
    cache: false,
    secret: 'test',
    staffCost: STAFF_COST,
    demo: true,
  });
  await people('yough-valley-hair', DEMO.desk);
  await people('pine-hollow-vfc', DEMO.community);
  await new Promise((done) => server.listen(0, done));
  salon = `http://localhost:${server.address().port}`;
  fire = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.closeAllConnections?.();
  await new Promise((done) => server.close(done));
  rmSync(dir, { recursive: true, force: true });
});

const form = (base, path, fields, cookie = '') =>
  fetch(`${base}${path}`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', 'sec-fetch-site': 'same-origin', cookie }, body: new URLSearchParams(fields) });
const cookieOf = (response) => (response.headers.get('set-cookie') ?? '').split(';')[0];
const words = (response) => decodeURIComponent((response.headers.get('location') ?? '').replace(/&sig=[\w-]+/, '').replaceAll('+', ' '));

test('each business’s sign-in page shows its own sign-ins, and they work', async () => {
  for (const [base, logins, other] of [[salon, DEMO.desk, DEMO.community], [fire, DEMO.community, DEMO.desk]]) {
    const page = await (await fetch(`${base}/staff`)).text();
    for (const shown of [logins.owner.email, logins.owner.password, logins.staff.email, logins.staff.password, 'cleared overnight']) assert.ok(page.includes(shown), shown);
    assert.ok(!page.includes(other.owner.password), 'not the other business’s');
    const signed = await form(base, '/staff/sign-in', { email: logins.owner.email, password: logins.owner.password });
    assert.equal(words(signed), '/staff');
  }
  const guestPage = await (await fetch(`${salon}/account/sign-in`)).text();
  for (const shown of [DEMO.customer.email, DEMO.customer.password]) assert.ok(guestPage.includes(shown), shown);
});

test('nobody can change a demo staff account, even an owner a visitor invited', async () => {
  const cookie = cookieOf(await form(salon, '/staff/sign-in', { email: DEMO.desk.owner.email, password: DEMO.desk.owner.password }));
  const { staff } = await server.business('yough-valley-hair');
  const hand = staff.list().find((one) => one.email === DEMO.desk.staff.email).account;
  const changed = await form(salon, '/staff/password', { current: DEMO.desk.owner.password, next: 'a brand new password' }, cookie);
  assert.match(words(changed), /The demo accounts can’t be changed/);
  for (const path of ['/staff/people/reset', '/staff/people/off', '/staff/people/role']) {
    const response = await form(salon, path, { account: hand, role: 'owner' }, cookie);
    assert.match(words(response), /The demo accounts can’t be changed/, path);
  }
  const who = staff.session({ headers: { cookie } });
  const { token } = await staff.invite(who, { email: 'visitor@example.com', name: 'Visitor', roles: ['owner'] });
  const visitor = await staff.accept(token, { name: 'Visitor', password: 'visitor password here' });
  const them = staff.session({ headers: { cookie: visitor.cookie.split(';')[0] } });
  assert.match((await staff.setDisabled(them, hand, true)).error, /can’t be changed/);
  assert.equal(await staff.endSessions(hand), 0);
  assert.equal((await staff.setDisabled(who, visitor.account, true)).ok, true, 'other accounts still can be');
});

test('nobody can change the demo customer', async () => {
  const { customers } = await server.business('pine-hollow-vfc');
  const guest = customers.list().find((one) => one.email === DEMO.customer.email).customer;
  assert.equal(await customers.resetToken(DEMO.customer.email), null, 'no reset link, as for an unknown email');
  assert.match((await customers.rename(guest, 'Someone Else')).error, /demo accounts/);
  assert.match((await customers.setDisabled(guest, true)).error, /demo accounts/);
  assert.ok((await customers.signIn(DEMO.customer.email, DEMO.customer.password)).ok);
});

test('the nightly reset exits once, at the reset hour, never in the first hour', () => {
  let at = Date.parse('2026-11-14T12:00:00-05:00');
  let exits = 0;
  const reset = nightly({ hour: 4, now: () => at, exit: () => exits++, log: () => {} });
  reset.stop();
  assert.equal(reset.check(), false, 'midday');
  at = Date.parse('2026-11-15T04:10:00-05:00');
  assert.equal(reset.check(), true, '4 am New York');
  assert.equal(exits, 1);
  at = Date.parse('2026-11-15T04:05:00-05:00');
  const restarted = nightly({ hour: 4, now: () => at, exit: () => exits++, log: () => {} });
  restarted.stop();
  at = Date.parse('2026-11-15T04:55:00-05:00');
  assert.equal(restarted.check(), false);
  assert.equal(exits, 1);
});

test('without DEMO, no demo sign-ins on the page', async () => {
  const plain = await createApp({ tenants: [{ id: 'yough-valley-hair', site: 'desk', hosts: ['localhost'] }], dataDir: ':memory:', cache: false, secret: 'test', staffCost: STAFF_COST });
  assert.equal((await plain.open()).length, 1, 'a setup link, as usual');
  await new Promise((done) => plain.listen(0, done));
  const page = await (await fetch(`http://localhost:${plain.address().port}/staff`)).text();
  assert.doesNotMatch(page, /Try the staff side/);
  assert.ok(!page.includes(DEMO.desk.owner.password));
  plain.closeAllConnections?.();
  await new Promise((done) => plain.close(done));
});
