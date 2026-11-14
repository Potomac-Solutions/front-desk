// Two businesses on one server, chosen by host name, and their staff's accounts: the salon at
// localhost, the fire company at 127.0.0.1. Each has its own log, its own owner and its own
// people; nothing of one is the other's.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createApp } from '../server.js';
import { launch, start, stop, OWNER, STAFF_COST } from './helpers.js';

// A redirect's location as words: the signature on its message (kit/notice) checked and taken off.
const plain = (location) => {
  location = String(location ?? '');
  if (/[?&](problem|done)=/.test(location) && !location.startsWith('?')) assert.match(location, /&sig=[\w-]{22}/, `unsigned message: ${location}`);
  return decodeURIComponent(location.replace(/&sig=[\w-]+/, '').replaceAll('+', ' '));
};

const dir = mkdtempSync(join(tmpdir(), 'front-desk-accounts-'));
const errors = [];
let browser;
let server;
let port;
let links;
const salon = () => `http://localhost:${port}`;
const fire = () => `http://127.0.0.1:${port}`;

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
  });
  links = await server.open();
  await new Promise((done) => server.listen(0, done));
  port = server.address().port;
  browser = await launch(chromium);
});
after(async () => {
  await browser?.close();
  server.closeAllConnections?.();
  await new Promise((done) => server.close(done));
  rmSync(dir, { recursive: true, force: true });
  assert.deepEqual(errors, [], 'no page errors in any browser');
});

/** A raw request with a Host header of our choosing (fetch won't send one). */
const raw = (host, path, { method = 'GET', headers = {}, body } = {}) =>
  new Promise((resolve, reject) => {
    const sent = request({ host: '127.0.0.1', port, path, method, headers: { host, ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}), ...headers } }, (res) => {
      let text = '';
      res.on('data', (chunk) => (text += chunk)).on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    sent.on('error', reject);
    sent.end(body);
  });

async function person(base, name) {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(`${name}: ${error.message}`));
  const post = async (path, form, headers = {}) => {
    const response = await context.request.post(`${base}${path}`, { form, headers, maxRedirects: 0 });
    return { status: response.status(), location: plain(response.headers().location ?? ''), text: await response.text() };
  };
  return { context, page, post };
}
const tokenOf = (link) => new URL(link).searchParams.get('token');

test('one server, two businesses by host name; a host nobody answers to is a 404', async () => {
  assert.deepEqual(links.map((link) => link.tenant.id), ['yough-valley-hair', 'pine-hollow-vfc'], 'a setup link for each, since nobody has an account');
  assert.match((await raw(`localhost:${port}`, '/')).text, /<h1>Yough Valley Hair Co\.<\/h1>/);
  assert.match((await raw(`127.0.0.1:${port}`, '/')).text, /<h1>Pine Hollow Volunteer Fire Company<\/h1>/);
  assert.match((await raw(`www.localhost:${port}`.replace('www.localhost', 'LOCALHOST'), '/')).text, /Yough Valley/, 'host names are matched without case');
  const stranger = await raw(`example.org:${port}`, '/');
  assert.equal(stranger.status, 404);
  assert.equal((await raw(`example.org:${port}`, '/_zb/sync/pull?since=0')).status, 404, 'nor its live data');
  // Each business's modules: the salon books, the fire company has a calendar.
  assert.equal((await raw(`127.0.0.1:${port}`, '/book/cut')).status, 404);
  assert.equal((await raw(`localhost:${port}`, '/events')).status, 404);
});

test('the first owner of each business sets up from that business’s own link, once', async () => {
  const salonLink = links.find((link) => link.tenant.id === 'yough-valley-hair').token;
  const fireLink = links.find((link) => link.tenant.id === 'pine-hollow-vfc').token;
  // A link token is only good at its own business.
  assert.match((await raw(`127.0.0.1:${port}`, `/staff/accept?token=${salonLink}`)).text, /That link has expired/);
  const page = await raw(`localhost:${port}`, `/staff/accept?token=${salonLink}`);
  assert.equal(page.headers['referrer-policy'], 'no-referrer');
  assert.equal(page.headers['cache-control'], 'no-store');
  assert.match(page.text, /Set up Yough Valley Hair Co\./);

  const rosa = await person(salon(), 'rosa');
  await rosa.page.goto(`${salon()}/staff/accept?token=${salonLink}`);
  await rosa.page.fill('#f-email', 'rosa@example.com');
  await rosa.page.fill('#f-name', 'Rosa Bittinger');
  await rosa.page.fill('#f-password', 'short');
  // The browser's own minlength would stop this; the server says it too.
  assert.match((await rosa.post('/staff/accept', { token: salonLink, email: 'rosa@example.com', name: 'Rosa', password: 'short' })).text, /Use at least 10 characters/);
  await rosa.page.fill('#f-password', 'salon owner password');
  await rosa.page.click('form[action="/staff/accept"] button');
  await rosa.page.waitForURL(/\/staff\?done=/);
  assert.match(await rosa.page.locator('main').innerText(), /Signed in as Rosa Bittinger[\s\S]*People[\s\S]*The front desk[\s\S]*Appointments/);
  assert.match((await raw(`localhost:${port}`, `/staff/accept?token=${salonLink}`)).text, /That link has expired/, 'used');
  assert.deepEqual(await server.open().then((more) => more.map((link) => link.tenant.id)), ['pine-hollow-vfc'], 'only the fire company still needs an owner');

  // The salon's session means nothing at the fire company.
  const cookie = (await rosa.context.cookies(salon())).find((one) => one.name === 'staff');
  assert.match((await raw(`127.0.0.1:${port}`, '/staff', { headers: { cookie: `staff=${cookie.value}` } })).text, /<button type="submit">Sign in<\/button>/);

  const dale = await person(fire(), 'dale');
  const made = await dale.post('/staff/accept', { token: fireLink, email: 'dale@example.com', name: 'Dale Glotfelty', password: 'fire hall password' });
  assert.equal(made.location, '/staff?done=You’re signed in.');
  // The same email at the other business is a different person, with a different password.
  assert.deepEqual((await (await server.business('pine-hollow-vfc')).staff.list()).map((one) => one.email), ['dale@example.com']);
  assert.equal((await rosa.post('/staff/sign-in', { email: 'dale@example.com', password: 'fire hall password' })).location, '/staff?problem=That email and password don’t match.');
  await rosa.context.close();
  await dale.context.close();
});

test('an owner invites staff; staff see the day sheet but not people; turning them off signs them out', async () => {
  const rosa = await person(salon(), 'rosa again');
  assert.equal((await rosa.post('/staff/sign-in', { email: 'ROSA@example.com', password: 'salon owner password' })).location, '/staff');
  await rosa.page.goto(`${salon()}/staff/people`);
  await rosa.page.fill('#f-email', 'sam@example.com');
  await rosa.page.fill('#f-name', 'Sam Teets');
  await rosa.page.selectOption('#f-role', 'staff');
  await rosa.page.click('form[action="/staff/people/invite"] button');
  const link = await rosa.page.locator('input[aria-label="The link"]').inputValue();
  assert.match(link, new RegExp(`^http://localhost:${port}/staff/accept\\?token=[A-Za-z0-9_-]{43}$`));
  assert.ok(!rosa.page.url().includes('token'), 'the link is on the page, not in its address');

  const sam = await person(salon(), 'sam');
  await sam.page.goto(link);
  assert.match(await sam.page.locator('main').innerText(), /Join Yough Valley Hair Co\.[\s\S]*For sam@example\.com/);
  await sam.page.fill('#f-password', 'sam staff password');
  await sam.page.click('form[action="/staff/accept"] button');
  await sam.page.waitForURL(/\/staff\?done=/);
  const samPage = await sam.page.locator('main').innerText();
  assert.match(samPage, /Signed in as Sam Teets[\s\S]*Appointments/);
  assert.doesNotMatch(samPage, /People/, 'staff don’t manage people');
  // Staff can't open or use the owner's pages.
  assert.equal((await sam.context.request.get(`${salon()}/staff/people`, { maxRedirects: 0 })).headers().location, '/staff');
  assert.equal((await sam.post('/staff/people/invite', { email: 'eve@example.com', role: 'owner' })).location, '/staff');
  const samAccount = (await server.business('yough-valley-hair')).staff.list().find((one) => one.email === 'sam@example.com').account;
  assert.equal((await sam.post('/staff/people/role', { account: samAccount, role: 'owner' })).location, '/staff');
  assert.deepEqual((await server.business('yough-valley-hair')).staff.list().find((one) => one.account === samAccount).roles, ['staff']);

  // Rosa turns Sam off: his open session ends at once.
  assert.equal((await rosa.post('/staff/people/off', { account: samAccount })).location, '/staff/people?done=Done.');
  assert.match((await sam.context.request.get(`${salon()}/staff`)).url(), /\/staff$/);
  assert.match(await (await sam.context.request.get(`${salon()}/staff`)).text(), /<button type="submit">Sign in<\/button>/);
  assert.equal((await sam.post('/staff/sign-in', { email: 'sam@example.com', password: 'sam staff password' })).location, '/staff?problem=That email and password don’t match.');
  // The last owner can't turn herself off or step down.
  const rosaAccount = (await server.business('yough-valley-hair')).staff.list().find((one) => one.email === 'rosa@example.com').account;
  assert.equal((await rosa.post('/staff/people/off', { account: rosaAccount })).location, '/staff/people?problem=The business needs an owner. Make someone else an owner first.');
  assert.equal((await rosa.post('/staff/people/role', { account: rosaAccount, role: 'staff' })).location, '/staff/people?problem=The business needs an owner. Make someone else an owner first.');

  // Back on, with a reset link: Sam sets a new password.
  await rosa.post('/staff/people/on', { account: samAccount });
  const reset = await rosa.post('/staff/people/reset', { account: samAccount });
  const resetLink = reset.text.match(/value="(http[^"]+)"/)[1];
  assert.match(reset.text, /Reset link[\s\S]*Send this link to Sam Teets/);
  const done = await sam.post('/staff/accept', { token: tokenOf(resetLink), password: 'sam new password' });
  assert.equal(done.location, '/staff?done=You’re signed in.');
  assert.equal((await sam.post('/staff/sign-in', { email: 'sam@example.com', password: 'sam staff password' })).location, '/staff?problem=That email and password don’t match.');
  await Promise.all([rosa.context.close(), sam.context.close()]);
});

test('wrong passwords lock an email for a while; signing out ends the session; a password change signs out other devices', async () => {
  const guesser = await person(fire(), 'guesser');
  for (let i = 0; i < 4; i++) assert.equal((await guesser.post('/staff/sign-in', { email: 'dale@example.com', password: `guess number ${i}` })).location, '/staff?problem=That email and password don’t match.');
  assert.equal((await guesser.post('/staff/sign-in', { email: 'dale@example.com', password: 'guess number 5' })).location, '/staff?problem=Too many tries. Wait 15 minutes, or ask an owner for a reset link.');
  assert.equal((await guesser.post('/staff/sign-in', { email: 'dale@example.com', password: 'fire hall password' })).location, '/staff?problem=Too many tries. Wait 15 minutes, or ask an owner for a reset link.', 'locked even for the right one');
  // The lock is the fire company's: the salon's Rosa signs in as usual.
  const rosa = await person(salon(), 'rosa three');
  assert.equal((await rosa.post('/staff/sign-in', { email: 'rosa@example.com', password: 'salon owner password' })).location, '/staff');
  const laptop = await person(salon(), 'rosa laptop');
  await laptop.post('/staff/sign-in', { email: 'rosa@example.com', password: 'salon owner password' });
  assert.equal((await rosa.post('/staff/password', { current: 'wrong current', next: 'salon owner password 2' })).location, '/staff/password?problem=Your current password isn’t right.');
  assert.equal((await rosa.post('/staff/password', { current: 'salon owner password', next: 'salon owner password 2' })).location, '/staff?done=Password changed. Your other devices are signed out.');
  assert.match(await (await laptop.context.request.get(`${salon()}/staff`)).text(), /<button type="submit">Sign in<\/button>/, 'the laptop is signed out');
  assert.match(await (await rosa.context.request.get(`${salon()}/staff`)).text(), /Signed in as Rosa/, 'this device stays');
  assert.equal((await rosa.post('/staff/sign-out', {})).location, '/staff?done=Signed out.');
  assert.match(await (await rosa.context.request.get(`${salon()}/staff`)).text(), /<button type="submit">Sign in<\/button>/);
  // Another site's form can't sign anyone in.
  assert.equal((await rosa.post('/staff/sign-in', { email: 'rosa@example.com', password: 'salon owner password 2' }, { 'sec-fetch-site': 'cross-site' })).status, 403);
  await Promise.all([guesser.context.close(), rosa.context.close(), laptop.context.close()]);
});

test('each business’s live data is its own, and no page can read anyone’s account', async () => {
  // A question sent to the fire company reaches only the fire company's inbox.
  const neighbour = await person(fire(), 'neighbour');
  await neighbour.post('/forms/hall', { name: 'Pat Friend', phone: '301-555-0177', date: '2027-02-14', guests: '40' });
  const fireDesk = (await server.business('pine-hollow-vfc')).desk;
  const salonDesk = (await server.business('yough-valley-hair')).desk;
  assert.equal(fireDesk.inbox().length, 1);
  assert.equal(salonDesk.inbox().length, 0);
  const pull = async (host) => {
    const all = [];
    for (let since = 0, i = 0; i < 100; i++) {
      const scope = encodeURIComponent(JSON.stringify({ accounts: true, 'staff-sessions': true, 'staff-tokens': true, inbox: true, busy: true, events: true, funds: true }));
      const answer = JSON.parse((await raw(host, `/_zb/sync/pull?since=${encodeURIComponent(since)}&scope=${scope}`)).text);
      all.push(...(answer.changes ?? []));
      if (!answer.changes?.length || answer.cursor === since) break;
      since = answer.cursor;
    }
    return all;
  };
  // A guest holds a time at the salon, so it has live data of its own.
  const { date } = salonDesk.days('cut', 'any').find((day) => day.free);
  const time = salonDesk.times('cut', 'any', date).find((one) => one.free).time;
  assert.equal((await raw(`localhost:${port}`, '/book/hold', { method: 'POST', body: new URLSearchParams({ service: 'cut', staff: 'any', date, time }).toString() })).headers.location, '/book/details');
  const salonChanges = await pull(`localhost:${port}`);
  const fireChanges = await pull(`127.0.0.1:${port}`);
  assert.deepEqual([...new Set(salonChanges.map((change) => change.collection))].sort(), ['busy']);
  assert.deepEqual([...new Set(fireChanges.map((change) => change.collection))].sort(), ['events', 'funds']);
  for (const changes of [salonChanges, fireChanges]) assert.ok(!/scrypt|@example\.com|Pat Friend/.test(JSON.stringify(changes)), 'no hashes, emails or names');
  await neighbour.context.close();
});

test('behind a proxy: someone guessing locks out their own address, not the owner on theirs', async () => {
  const site = await start(dir, 'desk', { name: 'behind-proxy', proxies: 1 });
  try {
    const post = (path, form, from) =>
      fetch(`${site.base}${path}`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': from }, body: new URLSearchParams(form) });
    const where = async (response) => plain((await response).headers.get('location'));
    // The guesser also sends its own X-Forwarded-For entry each time; only the proxy's counts.
    for (let i = 0; i < 4; i++) assert.equal(await where(post('/staff/sign-in', { email: OWNER.email, password: `guess ${i} xxxxxx` }, `10.9.9.${i}, 203.0.113.9`)), '/staff?problem=That email and password don’t match.');
    assert.match(await where(post('/staff/sign-in', { email: OWNER.email, password: 'guess 5 xxxxxx' }, '10.9.9.9, 203.0.113.9')), /Too many tries/);
    assert.match(await where(post('/staff/sign-in', { email: OWNER.email, password: OWNER.password }, '203.0.113.9')), /Too many tries/, 'the guesser stays locked out');
    assert.equal(await where(post('/staff/sign-in', { email: OWNER.email, password: OWNER.password }, '198.51.100.4')), '/staff', 'the owner gets in from her own phone');
    // A message typed into a link doesn't show on the real page.
    const typed = await (await fetch(`${site.base}/staff?problem=${encodeURIComponent('Your password expired. Call 555-0100.')}`)).text();
    assert.doesNotMatch(typed, /555-0100/);
  } finally {
    await stop(site.server);
  }
});
