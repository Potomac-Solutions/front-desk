// The admin, customer accounts and reports, over plain HTTP, for both kinds of business.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { start, stop, OWNER } from './helpers.js';

const STAFF = { email: 'hand@example.com', name: 'Desk Hand', password: 'desk hand password' };
const dir = mkdtempSync(join(tmpdir(), 'front-desk-admin-'));
let salon;
let fire;

before(async () => {
  salon = await start(dir, 'desk', { name: 'salon-admin' });
  fire = await start(dir, 'community', { name: 'fire-admin' });
  for (const site of [salon, fire]) {
    const owner = site.server.staff.list().find((one) => one.email === OWNER.email);
    await site.server.staff.accept((await site.server.staff.invite(owner, { email: STAFF.email, name: STAFF.name, roles: ['staff'] })).token, STAFF);
  }
});
after(async () => {
  await stop(salon.server);
  await stop(fire.server);
  rmSync(dir, { recursive: true, force: true });
});

/** One browser: its cookies, plain gets and form posts. */
function browser(site) {
  const jar = new Map();
  const remember = (response) => {
    for (const line of response.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const at = pair.indexOf('=');
      if (pair.slice(at + 1)) jar.set(pair.slice(0, at), pair.slice(at + 1));
      else jar.delete(pair.slice(0, at));
    }
    return response;
  };
  const cookie = () => [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
  const where = (response) => decodeURIComponent((response.headers.get('location') ?? '').replace(/&sig=[\w-]+/, '').replaceAll('+', ' '));
  return {
    async get(path) {
      const response = remember(await fetch(`${site.base}${path}`, { headers: { cookie: cookie() }, redirect: 'manual' }));
      return { status: response.status, type: response.headers.get('content-type'), location: where(response), text: await response.text() };
    },
    async post(path, form) {
      const response = remember(await fetch(`${site.base}${path}`, { method: 'POST', headers: { cookie: cookie(), 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form), redirect: 'manual' }));
      return { status: response.status, location: where(response), text: await response.text() };
    },
  };
}
async function signedIn(site, who) {
  const b = browser(site);
  await b.get('/');
  assert.equal((await b.post('/staff/sign-in', { email: who.email, password: who.password })).location, '/staff');
  return b;
}
/** Book the first free cut, as a guest: the appointment's key. */
async function bookCut(b, { name = 'Pat Quill', email = 'pat@example.com' } = {}) {
  const day = salon.server.desk.days('cut', 'any').find((one) => one.free);
  const time = salon.server.desk.times('cut', 'any', day.date).find((one) => one.free).time;
  assert.equal((await b.post('/book/hold', { service: 'cut', staff: 'any', date: day.date, time })).location, '/book/details');
  const booked = await b.post('/book/details', { name, phone: '301-555-0101', email, length: 'A trim' });
  const key = /^\/a\/(a[a-z0-9]+)\?/.exec(booked.location)?.[1];
  assert.ok(key, booked.location);
  return key;
}

test('the landing page leads with what the business does, and has no admin link for a guest', async () => {
  assert.match((await browser(salon).get('/')).text, /class="hero"[\s\S]*Book an appointment[\s\S]*id="book"[\s\S]*Visit/);
  const page = (await browser(fire).get('/')).text;
  assert.match(page, /class="hero"[\s\S]*See what’s on[\s\S]*href="\/give"/);
  assert.ok(!page.includes('>Admin</a></nav>'));
});

test('a customer signs up and their appointment follows the account; signed out it doesn’t', async () => {
  const phone = browser(salon);
  await phone.get('/');
  const key = await bookCut(phone);
  assert.equal((await phone.post('/account/sign-up', { name: 'Pat Quill', email: 'pat@example.com', password: 'pat quill password' })).location, '/account?done=Welcome. Your account is ready.');
  assert.match((await phone.get('/account')).text, new RegExp(`Hello, Pat[\\s\\S]*/a/${key}`));

  const laptop = browser(salon);
  await laptop.get('/');
  assert.equal((await laptop.get(`/a/${key}`)).status, 404, 'not theirs yet');
  assert.match((await laptop.post('/account/sign-in', { email: 'pat@example.com', password: 'not the password' })).text, /don’t match/);
  assert.equal((await laptop.post('/account/sign-in', { email: 'pat@example.com', password: 'pat quill password' })).location, '/account');
  assert.match((await laptop.get(`/a/${key}`)).text, /You’re booked/);
  // From the laptop the customer can cancel it: the chair is free again.
  assert.match((await laptop.post(`/a/${key}/cancel`, {})).location, /Cancelled/);
  assert.equal((await laptop.post('/account/sign-out', {})).location, '/');
  assert.equal((await laptop.get(`/a/${key}`)).status, 404);
});

test('a sign-up and a gift follow a fire company account', async () => {
  const b = browser(fire);
  await b.get('/');
  assert.equal((await b.post('/account/sign-up', { name: 'Lee Giver', email: 'lee@example.com', password: 'lee giver password' })).location, '/account?done=Welcome. Your account is ready.');
  const event = fire.server.desk.events().find((one) => one.capacity);
  assert.match((await b.post(`/events/${event.key}/signup`, { count: '2', name: 'Lee Giver', phone: '301-555-0102' })).location, /signed up/);
  const gift = /name="gift" value="(g[a-z0-9]+)"/.exec((await b.get('/give')).text)[1];
  assert.match((await b.post('/give', { gift, amount: '5000', name: 'Lee Giver', card: '4242 4242 4242 4242' })).location, /Thank you/);
  const page = (await b.get('/account')).text;
  assert.match(page, new RegExp(`${event.title}[\\s\\S]*Your giving[\\s\\S]*1 gift, \\$50 in all`));
});

test('a forgotten password: the same page either way, and the emailed link works once', async () => {
  const b = browser(salon);
  await b.get('/');
  await b.post('/account/sign-up', { name: 'Fen Forgets', email: 'fen@example.com', password: 'fen first password' });
  const nobody = (await b.post('/account/forgot', { email: 'nobody@example.com' })).text.match(/<main[\s\S]*<\/main>/)[0];
  const fen = (await b.post('/account/forgot', { email: 'fen@example.com' })).text.match(/<main[\s\S]*<\/main>/)[0];
  assert.equal(nobody, fen);
  const token = /\/account\/reset\?token=([\w-]{43})/.exec(salon.server.desk.messages()[0].body)[1];
  assert.equal((await b.post('/account/reset', { token, password: 'fen second password' })).location, '/account?done=Your new password is saved.');
  assert.match((await b.post('/account/reset', { token, password: 'fen third password' })).text, /expired/);
});

test('the admin is for staff; reports, settings and the outbox for owners; each business shows its own modules', async () => {
  const guest = browser(salon);
  await guest.get('/');
  for (const path of ['/admin', '/admin/appointments', '/admin/reports', '/admin/customers.csv']) {
    const page = await guest.get(path);
    assert.ok(!/Overview|text\/csv/.test(`${page.text}${page.type}`), path);
  }
  assert.equal((await guest.post('/admin/settings', { about: 'x', hours: 'x' })).location, '/admin');

  const hand = await signedIn(salon, STAFF);
  assert.match((await hand.get('/admin')).text, /Overview[\s\S]*Chairs booked, next 7 days/);
  for (const path of ['/admin/reports', '/admin/settings', '/admin/outbox']) assert.equal((await hand.get(path)).status, 403, path);
  assert.equal((await hand.get('/admin/events')).status, 404, 'the salon has no calendar');
  assert.equal((await hand.post('/admin/settings', { about: 'Taken over', hours: 'Never' })).location, '/admin');
  assert.notEqual(salon.server.desk.site.about, 'Taken over');

  const owner = await signedIn(fire, OWNER);
  assert.match((await owner.get('/admin')).text, /Events ahead[\s\S]*Given online, last 30 days/);
  assert.equal((await owner.get('/admin/appointments')).status, 404, 'the fire company takes no appointments');
  for (const path of ['/admin/reports', '/admin/settings', '/admin/outbox', '/admin/events', '/admin/gifts']) assert.equal((await owner.get(path)).status, 200, path);
});

test('staff find and cancel an appointment from the admin; it’s texted and in the activity', async () => {
  const b = browser(salon);
  await b.get('/');
  const key = await bookCut(b, { name: 'Sam Seeker', email: 'seek@example.com' });
  const hand = await signedIn(salon, STAFF);
  const found = (await hand.get('/admin/appointments?q=seek%40example')).text;
  assert.match(found, new RegExp(key));
  assert.ok(!found.includes('pat@example.com'));
  assert.match((await hand.post('/admin/appointments/cancel', { key })).location, /Sam Seeker’s appointment is cancelled/);
  assert.equal(salon.server.desk.store.get('appointments', key).status, 'cancelled');
  assert.match(salon.server.desk.messages()[0].body, /Sam Seeker, your cut and style with \w+ on .* is cancelled/);
  assert.match((await hand.get('/admin')).text, /Desk Hand<\/strong> cancelled Sam Seeker’s/);
});

test('an owner changes the words and prices; a bad price is refused', async () => {
  const owner = await signedIn(salon, OWNER);
  const form = { about: 'Two chairs and a kettle.', notice: '', hours: 'Tuesday to Saturday', fundAbout: '' };
  for (const svc of salon.server.desk.site.services) Object.assign(form, { [`price-${svc.id}`]: svc.price, [`about-${svc.id}`]: svc.about, [`cents-${svc.id}`]: String(svc.cents / 100) });
  assert.match((await owner.post('/admin/settings', { ...form, 'cents-cut': 'lots' })).location, /typical price/);
  assert.equal((await owner.post('/admin/settings', { ...form, 'price-cut': 'From $42', 'cents-cut': '42' })).location, '/admin/settings?done=Saved. The site shows it now.');
  assert.match((await browser(salon).get('/')).text, /Two chairs and a kettle\.[\s\S]*From \$42/);
  assert.equal(salon.server.desk.service('cut').cents, 4200);
});

test('an owner adds an event; people can sign up for it; the list downloads', async () => {
  const owner = await signedIn(fire, OWNER);
  const date = fire.server.desk.upcoming()[4].date;
  assert.match((await owner.post('/admin/events/new', { title: 'Hose drill', date, starts: '19:00', ends: '18:00', place: 'The lot' })).location, /end after the start/);
  assert.equal((await owner.post('/admin/events/new', { title: 'Hose drill', date, starts: '18:00', ends: '20:00', place: 'The lot', capacity: '10', about: 'Bring gloves.' })).location, '/admin/events?done=Added: Hose drill.');
  const event = fire.server.desk.events().find((one) => one.title === 'Hose drill');
  const b = browser(fire);
  await b.get('/');
  await b.post(`/events/${event.key}/signup`, { count: '3', name: '=cmd|calc', phone: '301-555-0103' });
  assert.equal(fire.server.desk.event(event.key).left, 7);
  const list = await owner.get(`/admin/events/${event.key}.csv`);
  assert.match(list.type, /^text\/csv/);
  assert.match(list.text, /^Name,Phone,Email,Places,Signed up\r\n'=cmd\|calc,301-555-0103,,3,/);
});

test('reports: appointment counts and gift totals add up, and download as CSV', async () => {
  const owner = await signedIn(salon, OWNER);
  const page = (await owner.get('/admin/reports?range=30d')).text;
  assert.match(page, /Appointments by day/);
  const csv = (await owner.get('/admin/reports.csv?range=30d')).text.trim().split('\r\n');
  assert.equal(csv[0], 'Day,Appointments,Takings at typical prices (USD)');
  assert.equal(csv.length, 31);

  const giver = await signedIn(fire, OWNER);
  const total = fire.server.desk.gifts().reduce((sum, gift) => sum + gift.cents, 0);
  assert.match((await giver.get('/admin/reports')).text, new RegExp(`Given online</span><strong>\\$${(total / 100).toLocaleString('en-US')}</strong>`));
  const rows = (await giver.get('/admin/reports.csv')).text.trim().split('\r\n');
  assert.equal(rows.slice(1).reduce((sum, row) => sum + Number(row.split(',')[2]), 0), total / 100);
});

test('an owner turns a customer off; staff can’t turn them back on', async () => {
  const b = browser(salon);
  await b.get('/');
  await b.post('/account/sign-up', { name: 'Off Switch', email: 'off@example.com', password: 'off switch password' });
  const one = (await salon.server.business('salon-admin')).customers.list();
  const id = one.find((c) => c.email === 'off@example.com').customer;
  const owner = await signedIn(salon, OWNER);
  assert.match((await owner.post(`/admin/customers/${id}/disabled`, { disabled: 'yes' })).location, /Turned off/);
  assert.equal((await b.get('/account')).location, '/account/sign-in');
  const hand = await signedIn(salon, STAFF);
  await hand.post(`/admin/customers/${id}/disabled`, { disabled: 'no' });
  assert.equal((await salon.server.business('salon-admin')).customers.get(id).disabled, true);
});
