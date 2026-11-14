// The public demo: a demo owner per business that anyone can sign in as and nobody can change,
// data that lives in memory, and a reset once a night.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';
import { DEMO_OWNER, nightly } from '../src/demo.js';
import { STAFF_COST } from './helpers.js';

let server;
let salon;
let fire;

before(async () => {
  server = await createApp({
    tenants: [
      { id: 'yough-valley-hair', site: 'desk', hosts: ['localhost'] },
      { id: 'pine-hollow-vfc', site: 'community', hosts: ['127.0.0.1'] },
    ],
    cache: false,
    secret: 'test',
    staffCost: STAFF_COST,
    demo: true,
  });
  await new Promise((done) => server.listen(0, done));
  salon = `http://localhost:${server.address().port}`;
  fire = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.closeAllConnections?.();
  await new Promise((done) => server.close(done));
});

const form = (base, path, fields, cookie = '') =>
  fetch(`${base}${path}`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', 'sec-fetch-site': 'same-origin', cookie }, body: new URLSearchParams(fields) });
const cookieOf = (response) => (response.headers.get('set-cookie') ?? '').split(';')[0];
const words = (response) => decodeURIComponent((response.headers.get('location') ?? '').replace(/&sig=[\w-]+/, '').replaceAll('+', ' '));
async function signIn(base) {
  const response = await form(base, '/staff/sign-in', { email: DEMO_OWNER.email, password: DEMO_OWNER.password });
  assert.equal(words(response), '/staff', `the demo owner signs in at ${base}`);
  return cookieOf(response);
}

test('every business starts with the demo owner, and asks nobody to set one up', async () => {
  assert.deepEqual(await server.open(), [], 'no setup links');
  for (const id of ['yough-valley-hair', 'pine-hollow-vfc']) {
    const { staff } = await server.business(id);
    assert.deepEqual(staff.list().map((one) => [one.email, one.roles]), [[DEMO_OWNER.email, ['owner']]], id);
  }
});

test('the sign-in page shows the demo login, and it works for both businesses', async () => {
  const page = await (await fetch(`${salon}/staff`)).text();
  assert.match(page, /Try the staff side/);
  assert.match(page, new RegExp(DEMO_OWNER.email.replace('.', '\\.')));
  assert.match(page, new RegExp(DEMO_OWNER.password));
  assert.match(page, /cleared overnight/);
  for (const base of [salon, fire]) {
    const cookie = await signIn(base);
    assert.match(await (await fetch(`${base}/staff`, { headers: { cookie } })).text(), /Signed in as Demo Owner/);
  }
});

test('nobody can change the demo account: password, roles, reset link or turning it off', async () => {
  const cookie = await signIn(salon);
  const { staff } = await server.business('yough-valley-hair');
  const demo = staff.list()[0].account;
  const changed = await form(salon, '/staff/password', { current: DEMO_OWNER.password, next: 'a brand new password' }, cookie);
  assert.match(words(changed), /The demo account can’t be changed/);
  for (const path of ['/staff/people/reset', '/staff/people/off', '/staff/people/role']) {
    const response = await form(salon, path, { account: demo, role: 'staff' }, cookie);
    assert.match(words(response), /The demo account can’t be changed/, path);
  }
  // A visitor who invites themselves as an owner can't touch it either.
  const who = staff.session({ headers: { cookie } });
  const { token } = await staff.invite(who, { email: 'visitor@example.com', name: 'Visitor', roles: ['owner'] });
  const visitor = await staff.accept(token, { name: 'Visitor', password: 'visitor password here' });
  const them = staff.session({ headers: { cookie: visitor.cookie.split(';')[0] } });
  assert.match((await staff.setDisabled(them, demo, true)).error, /can’t be changed/);
  assert.match((await staff.setRoles(them, demo, ['staff'])).error, /can’t be changed/);
  assert.match((await staff.resetLink(them, demo)).error, /can’t be changed/);
  assert.equal(await staff.endSessions(demo), 0);
  // The demo login still works, and other accounts can still be changed.
  await signIn(salon);
  assert.equal((await staff.setDisabled(who, visitor.account, true)).ok, true);
});

test('demo data lives in memory: a new server starts fresh', async () => {
  const { desk } = await server.business('pine-hollow-vfc');
  const again = await createApp({ tenants: [{ id: 'pine-hollow-vfc', site: 'community', hosts: ['127.0.0.1'] }], cache: false, secret: 'test', staffCost: STAFF_COST, demo: true });
  const fresh = await again.business('pine-hollow-vfc');
  assert.notEqual(fresh.desk, desk);
  assert.deepEqual(fresh.staff.list().map((one) => one.email), [DEMO_OWNER.email], 'only the demo owner, not the visitor from the other server');
  again.close();
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
  // Just restarted at 4:05: the first hour is left alone, so it doesn't restart again and again.
  at = Date.parse('2026-11-15T04:05:00-05:00');
  const restarted = nightly({ hour: 4, now: () => at, exit: () => exits++, log: () => {} });
  restarted.stop();
  at = Date.parse('2026-11-15T04:55:00-05:00');
  assert.equal(restarted.check(), false);
  assert.equal(exits, 1);
});

test('without DEMO, no demo owner and no demo login on the page', async () => {
  const plain = await createApp({ tenants: [{ id: 'yough-valley-hair', site: 'desk', hosts: ['localhost'] }], dataDir: ':memory:', cache: false, secret: 'test', staffCost: STAFF_COST });
  assert.equal((await plain.open()).length, 1, 'a setup link, as usual');
  await new Promise((done) => plain.listen(0, done));
  const page = await (await fetch(`http://localhost:${plain.address().port}/staff`)).text();
  assert.doesNotMatch(page, /Try the staff side|demo@example\.com/);
  plain.closeAllConnections?.();
  await new Promise((done) => plain.close(done));
});
