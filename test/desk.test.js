// The salon's walk: appointments, intake questions, the inbox. Each browser context is one
// guest's phone, or the front desk's laptop.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { start, stop, launch, device } from './helpers.js';
import { createDesk } from '../src/desk.js';

const dir = mkdtempSync(join(tmpdir(), 'front-desk-'));
const errors = [];
let browser;
let app;
let quick; // holds that last a second and a half

before(async () => {
  app = await start(dir, 'desk');
  quick = await start(dir, 'desk', { name: 'quick', holdMs: 1500 });
  browser = await launch(chromium);
});
after(async () => {
  await browser?.close();
  await stop(app.server);
  await stop(quick.server);
  rmSync(dir, { recursive: true, force: true });
  assert.deepEqual(errors, [], 'no page errors in any browser');
});
const open = (site, name, options) => device(browser, errors, site, name, options);

/** A day Jess works with `n` free colour times, and its first free time, after `skip` of them. */
function colourTime(site, skip = 0) {
  const { desk } = site.server;
  for (const { date } of desk.days('colour', 'jess')) {
    const free = desk.times('colour', 'jess', date).filter((one) => one.free);
    if (free.length > skip + 2) return { date, time: free[skip].time };
  }
  throw new Error('no free day');
}
const ann = { name: 'Ann Teets', phone: '301-555-0101', email: 'ann@example.com', patch: 'No', last: 'Never' };
const hold = (who, { service = 'colour', staff = 'jess', date, time }) => who.post('/book/hold', { service, staff, date, time });

test('without JavaScript: choose a service, a day and a time, answer the questions, and be booked', async () => {
  const guest = await open(app, 'booker', { javaScriptEnabled: false });
  const { page } = guest;
  assert.match(await page.locator('main').innerText(), /Book an appointment[\s\S]*Cut and style[\s\S]*Colour[\s\S]*90 minutes · From \$85/);
  await page.click('a[href="/book/colour"]');
  // Marco doesn't do colour, so he isn't offered.
  assert.deepEqual(await page.locator('.days').first().locator('a').allInnerTexts(), ['Anyone', 'Jess']);
  await page.click('a:text-is("Jess")');
  const { date, time } = colourTime(app);
  await page.goto(`${app.base}/book/colour?staff=jess&date=${date}`);
  await page.click(`free-times button[value="${time}"]`);
  await page.waitForURL(/\/book\/details$/);
  assert.match(await page.locator('main').innerText(), /Colour with Jess[\s\S]*Held for you until \d{1,2}:\d{2} [ap]m/);
  // The service's own questions are asked, and needed.
  await page.fill('#f-name', ann.name);
  await page.fill('#f-phone', ann.phone);
  assert.equal(await page.locator('#f-patch').count(), 1);
  assert.equal((await guest.post('/book/details', { name: ann.name, phone: ann.phone })).location, '/book/details?problem=Fill in “Have you had a patch test with us in the last six months?”.');
  assert.equal((await guest.post('/book/details', { ...ann, patch: 'Maybe' })).location, '/book/details?problem=Choose one for “Have you had a patch test with us in the last six months?”.');
  assert.equal((await guest.post('/book/details', { ...ann, phone: '555-0101' })).location, '/book/details?problem=Give a phone number with its area code.');
  await page.fill('#f-email', ann.email);
  await page.selectOption('#f-patch', 'No');
  await page.selectOption('#f-last', 'Never');
  await page.click('form[action="/book/details"] button');
  await page.waitForURL(/\/a\/a[a-z0-9]+\?done=/);
  assert.match(await page.locator('main').innerText(), /You’re booked[\s\S]*Colour with Jess, \w{3} \d{1,2} \w{3} at \d{1,2}:\d{2} [ap]m[\s\S]*Ann Teets[\s\S]*patch test[\s\S]*No/);
  const key = new URL(page.url()).pathname.split('/').pop();
  await page.goto(app.base);
  assert.match(await page.locator('main').innerText(), /Your appointments[\s\S]*colour with Jess/);

  // Someone else sees that time taken: its button is off, and holding it is refused.
  const other = await open(app, 'other', { javaScriptEnabled: false });
  await other.page.goto(`${app.base}/book/colour?staff=jess&date=${date}`);
  assert.equal(await other.page.locator(`free-times button[value="${time}"]`).isDisabled(), true);
  assert.match((await hold(other, { date, time })).location, /problem=Choose one of the times shown|problem=.*was just taken/);
  // Nor can they see or cancel it.
  assert.match(await other.get(`/a/${key}`), /Not found/);
  assert.equal((await other.post(`/a/${key}/cancel`, {})).location, `/a/${key}?problem=That isn’t one of your appointments.`);

  // The front desk sees it, with the answers; the confirmation text was sent.
  const front = await open(app, 'front', { javaScriptEnabled: false, staff: true });
  const sheet = await front.get(`/staff?day=${date}`);
  assert.match(sheet, /Jess[\s\S]*Colour<\/strong><br>Ann Teets, 301-555-0101[\s\S]*patch test with us in the last six months\?<\/dt><dd>No/);
  assert.match(sheet, /Text to 301-555-0101<\/strong>: Ann Teets, you’re booked for colour with Jess/);
  assert.match(sheet, /Email to ann@example.com/);
  await Promise.all([guest.context.close(), other.context.close(), front.context.close()]);
});

test('a time is held while you fill in the details: nobody else gets it, and choosing another lets it go', async () => {
  const a = await open(app, 'holder a', { javaScriptEnabled: false });
  const b = await open(app, 'holder b', { javaScriptEnabled: false });
  const first = colourTime(app, 2);
  assert.equal((await hold(a, first)).location, '/book/details');
  assert.match((await hold(b, first)).location, /problem=/);
  // A 90-minute colour takes six pieces: a cut starting an hour in overlaps and is refused too.
  const overlap = `${String(Number(first.time.slice(0, 2)) + 1).padStart(2, '0')}${first.time.slice(2)}`;
  assert.match((await hold(b, { service: 'cut', date: first.date, time: overlap })).location, /problem=/);
  // On a day nobody has touched: a colour ending where another begins is fine; one that would
  // run into it isn't, even though its own first piece is free.
  const last = app.server.desk.days('colour', 'jess').at(-1).date;
  assert.equal((await hold(a, { date: last, time: '11:00' })).location, '/book/details');
  assert.match((await hold(b, { date: last, time: '10:30' })).location, /problem=/);
  assert.equal((await hold(b, { date: last, time: '09:30' })).location, '/book/details');
  await b.post('/book/letgo', {});
  // A chooses a different time: the first is free for B at once.
  const second = colourTime(app, 12);
  assert.equal((await hold(a, second)).location, '/book/details');
  assert.equal((await hold(b, first)).location, '/book/details');
  // Letting go frees it; with nothing held, the details page sends you back.
  assert.equal((await a.post('/book/letgo', {})).location, '/book/colour');
  assert.equal((await b.post('/book/letgo', {})).location, '/book/colour');
  assert.equal((await a.post('/book/details', ann)).location, '/?problem=Choose a time first.');
  assert.equal(app.server.desk.times('colour', 'jess', first.date).find((one) => one.time === first.time).free, true);
  await a.context.close();
  await b.context.close();
});

test('two guests pressing the same time at the same moment: one holds it', async () => {
  const a = await open(app, 'race a', { javaScriptEnabled: false });
  const b = await open(app, 'race b', { javaScriptEnabled: false });
  const at = colourTime(app, 6);
  const answers = await Promise.all([hold(a, at), hold(b, at)]);
  assert.equal(answers.filter((one) => one.location === '/book/details').length, 1, JSON.stringify(answers));
  await a.post('/book/letgo', {});
  await b.post('/book/letgo', {});
  await a.context.close();
  await b.context.close();
});

test('free times are live: someone else holding or letting go of a time shows at once', async () => {
  const at = colourTime(app, 8);
  const watcher = await open(app, 'watcher');
  await watcher.page.goto(`${app.base}/book/colour?staff=jess&date=${at.date}`);
  await watcher.page.waitForFunction(() => customElements.get('free-times'));
  await watcher.page.waitForTimeout(400);
  const button = watcher.page.locator(`free-times button[value="${at.time}"]`);
  assert.equal(await button.isDisabled(), false);
  const other = await open(app, 'live holder', { javaScriptEnabled: false });
  await hold(other, at);
  await watcher.page.waitForFunction((time) => document.querySelector(`free-times button[value="${time}"]`)?.disabled, at.time, { timeout: 5000 });
  await other.post('/book/letgo', {});
  // A colour takes 90 minutes: someone holding 2:00 greys out 1:00 to 2:00 too, not 12:30.
  const last = app.server.desk.days('colour', 'jess').at(-1).date;
  await watcher.page.goto(`${app.base}/book/colour?staff=jess&date=${last}`);
  await watcher.page.waitForTimeout(400);
  await hold(other, { date: last, time: '14:00' });
  await watcher.page.waitForFunction(() => document.querySelector('free-times button[value="13:00"]')?.disabled, null, { timeout: 5000 });
  assert.equal(await watcher.page.locator('free-times button[value="12:30"]').isDisabled(), false);
  await other.post('/book/letgo', {});
  await watcher.page.goto(`${app.base}/book/colour?staff=jess&date=${at.date}`);
  await watcher.page.waitForTimeout(400);
  await watcher.page.waitForFunction((time) => !document.querySelector(`free-times button[value="${time}"]`)?.disabled, at.time, { timeout: 5000 });
  // "Anyone": a time stays open while either person is free for it.
  // The last day both work: earlier tests fill the first days, and late in the day today has few times left.
  const cut = app.server.desk.days('cut', 'any').filter(({ date }) => app.server.desk.whoCan('cut', 'any', date).length === 2).at(-1).date;
  const freeWith = (staff) => new Set(app.server.desk.times('cut', staff, cut).filter((one) => one.free).map((one) => one.time));
  const both = [...freeWith('jess')].reverse().find((time) => freeWith('marco').has(time));
  await watcher.page.goto(`${app.base}/book/cut?staff=any&date=${cut}`);
  await watcher.page.waitForTimeout(400);
  await hold(other, { service: 'cut', staff: 'any', date: cut, time: both });
  await watcher.page.waitForTimeout(800);
  assert.equal(await watcher.page.locator(`free-times button[value="${both}"]`).isDisabled(), false, 'the other chair is still free');
  const third = await open(app, 'third', { javaScriptEnabled: false });
  await hold(third, { service: 'cut', staff: 'any', date: cut, time: both });
  await watcher.page.waitForFunction((time) => document.querySelector(`free-times button[value="${time}"]`)?.disabled, both, { timeout: 5000 });
  assert.match((await hold(watcher, { service: 'cut', staff: 'any', date: cut, time: both })).location, /was just taken/);
  await other.post('/book/letgo', {});
  await third.post('/book/letgo', {});
  await Promise.all([watcher.context.close(), other.context.close(), third.context.close()]);
});

test('a hold runs out: someone else can take the time, and a late booking is told; if nobody did, it still books', async () => {
  const a = await open(quick, 'slow', { javaScriptEnabled: false });
  const b = await open(quick, 'quick', { javaScriptEnabled: false });
  const at = colourTime(quick, 3);
  await hold(a, at);
  await new Promise((done) => setTimeout(done, 1800));
  assert.equal((await hold(b, at)).location, '/book/details');
  assert.equal((await a.post('/book/details', ann)).location, `/book/colour?date=${at.date}&problem=Sorry, someone booked that time while you were filling this in. Choose another.`);
  // B's runs out too, but nobody takes it: B still gets it.
  await new Promise((done) => setTimeout(done, 1800));
  assert.match(await b.get('/book/details'), /Your hold ran out, but you can still book it/);
  assert.match((await b.post('/book/details', ann)).location, /^\/a\/a[a-z0-9]+\?done=Booked/);
  // The sweep writes lapsed holds down for live pages.
  const c = await open(quick, 'lapsed', { javaScriptEnabled: false });
  const later = colourTime(quick, 10);
  await hold(c, later);
  await new Promise((done) => setTimeout(done, 1800));
  assert.equal(await quick.server.desk.sweep(), 6, 'six 15-minute pieces');
  assert.ok(!quick.server.desk.store.get('busy', later.date.replaceAll('-', '')).taken.jess.includes(later.time.replace(':', '')));
  await Promise.all([a.context.close(), b.context.close(), c.context.close()]);
});

test('cancelling frees the time at once; the front desk can cancel too, and the guest is texted', async () => {
  const guest = await open(app, 'canceller', { javaScriptEnabled: false });
  const at = colourTime(app, 4);
  await hold(guest, at);
  const booked = (await guest.post('/book/details', { name: 'Bo Fike', phone: '240-555-0199', patch: 'Yes', last: 'Longer ago' })).location;
  const key = booked.match(/\/a\/(a[a-z0-9]+)/)[1];
  assert.equal(app.server.desk.times('colour', 'jess', at.date).find((one) => one.time === at.time).free, false);
  assert.equal((await guest.post(`/a/${key}/cancel`, {})).location, `/a/${key}?done=Cancelled. The time is free for someone else.`);
  assert.equal(app.server.desk.times('colour', 'jess', at.date).find((one) => one.time === at.time).free, true);
  assert.match(await guest.get(`/a/${key}`), /<h1>Cancelled<\/h1>/);
  assert.equal((await guest.post(`/a/${key}/cancel`, {})).location, `/a/${key}?problem=That appointment is already cancelled.`);

  await hold(guest, at);
  const again = (await guest.post('/book/details', { name: 'Bo Fike', phone: '240-555-0199', patch: 'Yes', last: 'Longer ago' })).location.match(/\/a\/(a[a-z0-9]+)/)[1];
  const front = await open(app, 'cancelling desk', { javaScriptEnabled: false, staff: true });
  assert.equal((await front.post('/staff/cancel', { key: again })).location, `/staff?day=${at.date}&done=Bo Fike’s appointment is cancelled; we’ve texted them.`);
  assert.equal(app.server.desk.times('colour', 'jess', at.date).find((one) => one.time === at.time).free, true);
  assert.match(await front.get('/staff'), /Text to 240-555-0199<\/strong>: Bo Fike, your colour with Jess on [^<]+ is cancelled/);
  // Without signing in, the desk's posts do nothing.
  const outsider = await open(app, 'outsider', { javaScriptEnabled: false });
  assert.match(await outsider.get('/staff'), /<button type="submit">Sign in<\/button>/);
  assert.equal((await outsider.post('/staff/cancel', { key: again })).location, '/staff');
  await Promise.all([guest.context.close(), front.context.close(), outsider.context.close()]);
});

test('only the times shown can be held: no made-up time, day or person', async () => {
  const guest = await open(app, 'trier', { javaScriptEnabled: false });
  const at = colourTime(app, 5);
  const refused = 'problem=Choose one of the times shown.';
  assert.ok((await hold(guest, { ...at, time: '07:00' })).location.endsWith(refused), 'before opening');
  assert.ok((await hold(guest, { ...at, time: '16:00' })).location.endsWith(refused), 'runs past closing');
  assert.ok((await hold(guest, { ...at, time: `${at.time.slice(0, 3)}07` })).location.endsWith(refused), 'not on the quarter hour');
  assert.ok((await hold(guest, { ...at, staff: 'marco' })).location.endsWith(refused), 'Marco doesn’t do colour');
  assert.ok((await hold(guest, { ...at, date: '2020-01-07' })).location.endsWith(refused), 'in the past');
  const monday = app.server.desk.upcoming().find(({ day }) => day === 1).date;
  assert.ok((await hold(guest, { ...at, date: monday })).location.endsWith(refused), 'nobody works Mondays');
  assert.ok((await hold(guest, { ...at, service: 'perm' })).location.endsWith(refused), 'not a service');
  // With anyone: a 5 pm cut runs past Jess's closing, so it's Marco's.
  const both = app.server.desk.days('cut', 'any').filter(({ date }) => app.server.desk.whoCan('cut', 'any', date).length === 2).at(-1).date;
  assert.equal((await hold(guest, { service: 'cut', staff: 'any', date: both, time: '17:00' })).location, '/book/details');
  assert.equal(app.server.desk.pending({ pub: app.server.desk.store.under('pending').find((one) => one.time === '17:00').key }).staff, 'marco');
  await guest.post('/book/letgo', {});
  await guest.context.close();
});

test('a form reaches the inbox, checked against its fields; the desk marks it handled', async () => {
  const guest = await open(app, 'bride', { javaScriptEnabled: false });
  await guest.page.goto(app.base);
  await guest.page.click('a[href="/forms/wedding"]');
  await guest.page.fill('#f-name', 'Kim Friend');
  await guest.page.fill('#f-phone', '301-555-0123');
  await guest.page.fill('#f-date', '2027-06-12');
  await guest.page.fill('#f-people', '6');
  await guest.page.fill('#f-message', 'Four bridesmaids and two moms, at the lake.');
  await guest.page.click('form[action="/forms/wedding"] button');
  await guest.page.waitForURL(/done=/);
  assert.match(await guest.page.locator('.ok').innerText(), /Sent/);
  const base = { name: 'Kim', phone: '301-555-0123', date: '2027-06-12', people: '6' };
  assert.equal((await guest.post('/forms/wedding', { ...base, people: '40' })).location, '/forms/wedding?problem=Give a number from 1 to 20 for “How many people”.');
  assert.equal((await guest.post('/forms/wedding', { ...base, date: 'June' })).location, '/forms/wedding?problem=Give a date for “The wedding date”.');
  assert.equal((await guest.post('/forms/wedding', { ...base, email: 'kim@' })).location, '/forms/wedding?problem=Check the email address.');
  assert.equal((await guest.post('/forms/nope', base)).status, 404);
  const front = await open(app, 'inbox', { javaScriptEnabled: false, staff: true });
  const sheet = await front.get('/staff');
  assert.match(sheet, /Wedding party enquiry<\/strong><dl><dt>Your name<\/dt><dd>Kim Friend<\/dd>[\s\S]*How many people<\/dt><dd>6[\s\S]*Four bridesmaids/);
  const key = sheet.match(/name="key" value="(m[a-z0-9]+)"/)[1];
  assert.equal((await front.post('/staff/handled', { key })).location, '/staff?done=Marked handled.');
  assert.equal((await front.post('/staff/handled', { key: 'mzzzzzzzzzz' })).location, '/staff?problem=That message isn’t in the inbox.');
  assert.equal(app.server.desk.inbox().length, 1);
  assert.match(await front.get('/staff'), /Handled/);
  await guest.context.close();
  await front.context.close();
});

test('a page reads which times are taken, never who took them; it writes nothing; other sites can’t post', async () => {
  const nosy = await open(app, 'nosy', { javaScriptEnabled: false });
  const all = await nosy.pullAll(['busy', 'appointments', 'pending', 'messages', 'inbox', 'slots', 'slot-holds']);
  assert.ok(all.some((change) => change.collection === 'busy'));
  for (const change of all) assert.ok(['busy', 'events', 'funds'].includes(change.collection), `${change.collection} isn't sent`);
  assert.ok(!JSON.stringify(all).includes('301-555'), 'no phone numbers');
  assert.equal(await nosy.push('busy', 'x', 'taken', {}), 403);
  assert.equal(await nosy.push('notes', 'x', 'text', 'hi'), 403);
  assert.equal((await nosy.post('/book/hold', colourTime(app), { 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await nosy.post('/staff/sign-in', {}, { 'sec-fetch-site': 'cross-site' })).status, 403);
  // The salon has no calendar or giving.
  assert.equal((await nosy.context.request.get(`${app.base}/events`)).status(), 404);
  assert.equal((await nosy.context.request.get(`${app.base}/give`)).status(), 404);
  assert.equal((await nosy.post('/give', { amount: '5000', name: 'x', card: '4242' })).status, 404);
  await nosy.context.close();
});

test('today’s times start an hour from now, on the quarter hour', async () => {
  // Friday 20 November 2026, 10:05 in Oakland.
  const desk = await createDesk({ site: 'desk', now: () => Date.parse('2026-11-20T15:05:00Z') });
  assert.equal(desk.today(), '2026-11-20');
  assert.equal(desk.times('cut', 'jess', '2026-11-20')[0].time, '11:15');
  assert.equal(desk.times('cut', 'jess', '2026-11-21')[0].time, '09:00');
  assert.equal(desk.times('cut', 'jess', '2026-11-20').at(-1).time, '16:15', 'a 45-minute cut ends by 5');
  assert.deepEqual(desk.times('cut', 'jess', '2026-11-23'), [], 'Jess is off on Mondays');
});
