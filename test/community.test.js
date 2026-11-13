// The fire company's walk: the calendar, sign-ups with places, giving, and the volunteer form.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { start, stop, launch, device } from './helpers.js';

const dir = mkdtempSync(join(tmpdir(), 'community-'));
const errors = [];
let browser;
let app;

before(async () => {
  app = await start(dir, 'community');
  browser = await launch(chromium);
});
after(async () => {
  await browser?.close();
  await stop(app.server);
  rmSync(dir, { recursive: true, force: true });
  assert.deepEqual(errors, [], 'no page errors in any browser');
});
const open = (name, options) => device(browser, errors, app, name, options);
const event = (title) => app.server.desk.events().find((one) => one.title.startsWith(title));
const dale = { name: 'Dale Glotfelty', phone: '301-555-0102' };
const signUp = (who, title, count, person = dale) => who.post(`/events/${event(title).key}/signup`, { count: String(count), ...person });

test('without JavaScript: the calendar, signing up for places, and giving them back', async () => {
  const guest = await open('neighbour', { javaScriptEnabled: false });
  const { page } = guest;
  assert.match(await page.locator('main').innerText(), /Burn ban[\s\S]*Coming up[\s\S]*pancake breakfast[\s\S]*Everyone welcome[\s\S]*CPR and first-aid class[\s\S]*12 of 12 places left/);
  await page.click('footer a[href="/events"]');
  assert.equal(await page.locator('.card').count(), 4);
  assert.match(await page.locator('main').innerText(), /NOVEMBER|DECEMBER/);
  // An open event needs no sign-up.
  await page.click(`a[href="/events/${event('All-you-can-eat').key}"]`);
  assert.match(await page.locator('main').innerText(), /No need to sign up/);
  assert.equal((await signUp(guest, 'All-you-can-eat', 2)).location, `/events/${event('All-you-can-eat').key}?problem=No need to sign up for this one. Just come.`);

  const cpr = event('CPR');
  await page.goto(`${app.base}/events/${cpr.key}`);
  await page.fill('#f-count', '3');
  await page.fill('#f-name', dale.name);
  await page.fill('#f-phone', dale.phone);
  await page.click('form[action$="/signup"] button');
  await page.waitForURL(/\/r\/r[a-z0-9]+\?done=/);
  assert.match(await page.locator('main').innerText(), /You’re signed up[\s\S]*3 places, for Dale Glotfelty[\s\S]*9 of 12 places left/);
  const rsvp = new URL(page.url()).pathname.split('/').pop();
  assert.equal(event('CPR').left, 9);
  // Signing up again is refused; the event page links to the sign-up instead.
  assert.equal((await signUp(guest, 'CPR', 1)).location, `/events/${cpr.key}?problem=You’re already signed up. Cancel that first to change it.`);
  assert.match(await guest.get(`/events/${cpr.key}`), /You’re signed up for 3 places/);
  assert.match(await guest.get('/'), /You’re signed up[\s\S]*CPR and first-aid class<\/a> · 3 places/);
  // Someone else can't see or cancel it.
  const other = await open('other', { javaScriptEnabled: false });
  assert.match(await other.get(`/r/${rsvp}`), /Not found/);
  assert.equal((await other.post(`/r/${rsvp}/cancel`, {})).location, `/r/${rsvp}?problem=That isn’t one of your sign-ups.`);
  // The office sees who's coming, and the text that went out.
  const office = await open('office', { javaScriptEnabled: false, staff: true });
  const sheet = await office.get('/staff');
  assert.match(sheet, /<h1>The office<\/h1>/);
  assert.match(sheet, /CPR and first-aid class, [^<]+<\/h3>[\s\S]*Dale Glotfelty, 301-555-0102 · 3/);
  assert.match(sheet, /Text to 301-555-0102<\/strong>: Dale Glotfelty, you’re signed up for CPR and first-aid class, [^<]+ \(3 places\)/);

  await page.click('form[action$="/cancel"] button');
  await page.waitForURL(/done=/);
  assert.equal(event('CPR').left, 12);
  assert.match(await page.locator('main').innerText(), /Cancelled/);
  assert.equal((await guest.post(`/r/${rsvp}/cancel`, {})).location, `/r/${rsvp}?problem=That isn’t one of your sign-ups.`);
  await Promise.all([guest.context.close(), other.context.close(), office.context.close()]);
});

test('places run out: only as many as are left, never more than a party, and the last ones go to one party', async () => {
  const people = await Promise.all(['a', 'b', 'c', 'd'].map((name) => open(`party ${name}`, { javaScriptEnabled: false })));
  assert.equal((await signUp(people[0], 'CPR', 9)).location, `/events/${event('CPR').key}?problem=Choose from 1 to 8 places.`);
  assert.equal((await signUp(people[0], 'CPR', 0)).location, `/events/${event('CPR').key}?problem=Choose from 1 to 8 places.`);
  assert.equal((await signUp(people[0], 'CPR', 2, { name: 'Al', phone: '555' })).location, `/events/${event('CPR').key}?problem=Give a phone number with its area code.`);
  assert.match((await signUp(people[0], 'CPR', 8)).location, /done=/);
  assert.equal(event('CPR').left, 4);
  // Two parties of three for the last four places, at the same moment: one gets in.
  const answers = await Promise.all([signUp(people[1], 'CPR', 3), signUp(people[2], 'CPR', 3)]);
  assert.equal(answers.filter((one) => one.location.includes('done=')).length, 1, JSON.stringify(answers));
  assert.ok(answers.some((one) => one.location.endsWith('problem=Only 1 place left.')));
  assert.match((await signUp(people[3], 'CPR', 1)).location, /done=/);
  assert.equal(event('CPR').left, 0);
  assert.equal((await signUp(people[2], 'CPR', 1)).location, `/events/${event('CPR').key}?problem=Sorry, it’s full.`);
  // Places are never handed out twice.
  const given = app.server.desk.rsvpsAt(event('CPR').key).flatMap((one) => one.places);
  assert.equal(new Set(given).size, 12);
  assert.equal(given.length, 12);
  // A double press signs up once, even when the second arrives while the first is being written.
  const form = new URLSearchParams({ count: '2', ...dale });
  const twice = await Promise.all([app.server.desk.signUp({ pub: 'presser' }, event('Bingo').key, form), app.server.desk.signUp({ pub: 'presser' }, event('Bingo').key, form)]);
  assert.equal(twice.filter((one) => one.ok).length, 1, JSON.stringify(twice));
  assert.equal(event('Bingo').left, 78);
  await Promise.all(people.map((one) => one.context.close()));
});

test('places left are live on every open calendar', async () => {
  const watcher = await open('watcher');
  await watcher.page.goto(`${app.base}/events`);
  await watcher.page.waitForFunction(() => customElements.get('places-left'));
  await watcher.page.waitForTimeout(400);
  const bingo = watcher.page.locator('.card', { has: watcher.page.locator(`a[href="/events/${event('Bingo').key}"]`) }).locator('places-left');
  assert.equal((await bingo.innerText()).trim(), '78 of 80 places left');
  const guest = await open('live signer', { javaScriptEnabled: false });
  const done = (await signUp(guest, 'Bingo', 6)).location;
  await bingo.locator('text=72 of 80 places left').waitFor({ timeout: 5000 });
  await guest.post(`${done.match(/^\/r\/r[a-z0-9]+/)[0]}/cancel`, {});
  await bingo.locator('text=78 of 80 places left').waitFor({ timeout: 5000 });
  await watcher.context.close();
  await guest.context.close();
});

test('giving: a declined card gives nothing, a gift is charged once, and the total moves live', async () => {
  const watcher = await open('fund watcher');
  await watcher.page.waitForFunction(() => customElements.get('fund-progress'));
  await watcher.page.waitForTimeout(400);
  assert.match(await watcher.page.locator('fund-progress').innerText(), /\$18,400 of \$25,000 · 74%/);

  const giver = await open('giver', { javaScriptEnabled: false });
  await giver.page.goto(`${app.base}/give`);
  const gift = await giver.page.locator('[name=gift]').getAttribute('value');
  const form = { gift, amount: '5000', name: 'Rosa Bittinger', email: 'rosa@example.com' };
  assert.equal((await giver.post('/give', { ...form, card: '4000 0000 0000 0002' })).location, '/give?problem=That card was declined. Try another.');
  assert.equal(app.server.desk.fund().raised, 1_840_000);
  // Then the gift, from a fresh page.
  await giver.page.goto(`${app.base}/give`);
  await giver.page.fill('#f-name', 'Rosa Bittinger');
  await giver.page.fill('#f-email', 'rosa@example.com');
  await giver.page.fill('#f-other', '250');
  await giver.page.fill('#f-card', '4242 4242 4242 4242');
  const key = await giver.page.locator('[name=gift]').getAttribute('value');
  await giver.page.click('form[action="/give"] button');
  await giver.page.waitForURL(/done=/);
  assert.match(await giver.page.locator('.ok').innerText(), /Thank you for your gift of \$250\.00/);
  await watcher.page.locator('fund-progress', { hasText: '$18,650 of $25,000' }).waitFor({ timeout: 5000 });
  assert.match(await watcher.page.locator('fund-progress').innerText(), /1 gift online so far/);
  // Pressing Give again with the same page gives once.
  assert.equal((await giver.post('/give', { gift: key, amount: '5000', name: 'Rosa', card: '4242' })).location, '/give?done=Thank you for your gift of $250.00.');
  assert.equal(app.server.desk.fund().raised, 1_865_000);
  assert.equal(app.server.desk.gifts().length, 1);
  // Amounts and names are checked; someone else can't reuse the key.
  const check = (extra) => giver.post('/give', { gift: app.server.desk.newKey('g'), amount: '5000', name: 'Rosa', card: '4242', ...extra });
  assert.equal((await check({ other: '0.50' })).location, '/give?problem=Choose an amount from $1 to $10,000.');
  assert.equal((await check({ other: '20000' })).location, '/give?problem=Choose an amount from $1 to $10,000.');
  assert.equal((await check({ amount: 'lots' })).location, '/give?problem=Choose an amount from $1 to $10,000.');
  assert.equal((await check({ name: '' })).location, '/give?problem=Fill in “Your name”.');
  assert.equal((await check({ gift: 'nope' })).location, '/give?problem=Open the giving page again.');
  const stranger = await open('stranger', { javaScriptEnabled: false });
  assert.equal((await stranger.post('/give', { gift: key, amount: '5000', name: 'X', card: '4242' })).location, '/give?problem=Open the giving page again.');
  const office = await open('giving office', { javaScriptEnabled: false, staff: true });
  const sheet = await office.get('/staff');
  assert.match(sheet, /Rosa Bittinger<\/td><td>\$250\.00/);
  assert.match(sheet, /Email to rosa@example.com<\/strong>: Rosa Bittinger, thank you for your gift of \$250\.00 to The new engine fund/);
  await Promise.all([watcher.context.close(), giver.context.close(), stranger.context.close(), office.context.close()]);
});

test('the volunteer form needs its tick box; the hall form reaches the inbox', async () => {
  const guest = await open('volunteer', { javaScriptEnabled: false });
  const base = { name: 'Sam Teets', phone: '304-555-0111', interest: 'EMS' };
  assert.equal((await guest.post('/forms/volunteer', base)).location, '/forms/volunteer?problem=Tick “I am 18 or older, or I’ll come with a parent or guardian”.');
  assert.equal((await guest.post('/forms/volunteer', { ...base, interest: 'Arson', adult: 'yes' })).location, '/forms/volunteer?problem=Choose one for “What interests you”.');
  await guest.page.goto(`${app.base}/forms/volunteer`);
  await guest.page.fill('#f-name', base.name);
  await guest.page.fill('#f-phone', base.phone);
  await guest.page.selectOption('#f-interest', 'EMS');
  await guest.page.check('#f-adult');
  await guest.page.click('form[action="/forms/volunteer"] button');
  await guest.page.waitForURL(/done=/);
  assert.equal((await guest.post('/forms/hall', { name: 'Pat', phone: '301-555-0177', date: '2027-02-14', guests: '151' })).location, '/forms/hall?problem=Give a number from 1 to 150 for “How many guests”.');
  const office = await open('volunteer office', { javaScriptEnabled: false, staff: true });
  assert.match(await office.get('/staff'), /Join as a volunteer<\/strong><dl>[\s\S]*What interests you<\/dt><dd>EMS<\/dd><dt>I am 18 or older[^<]*<\/dt><dd>Yes/);
  await guest.context.close();
  await office.context.close();
});

test('a page reads events and the fund, never names; it writes nothing; the fire company has no appointments', async () => {
  const nosy = await open('nosy', { javaScriptEnabled: false });
  await signUp(nosy, 'Open house', 1).catch(() => {});
  const all = await nosy.pullAll(['rsvps', 'gifts', 'inbox', 'messages', 'payments', 'places', 'place-holds']);
  assert.ok(all.some((change) => change.collection === 'events'));
  assert.ok(all.some((change) => change.collection === 'funds'));
  for (const change of all) assert.ok(['busy', 'events', 'funds'].includes(change.collection), `${change.collection} isn't sent`);
  assert.ok(!/Glotfelty|Bittinger@|555-01/.test(JSON.stringify(all)), 'no names or phone numbers');
  assert.equal(await nosy.push('funds', 'engine', 'raised', 99_999_999), 403);
  assert.equal(await nosy.push('events', event('CPR').key, 'left', 99), 403);
  assert.equal((await signUp(nosy, 'Bingo', 1)).location.includes('done='), true);
  assert.equal((await nosy.post(`/events/${event('Bingo').key}/signup`, { count: '1', ...dale }, { 'sec-fetch-site': 'cross-site' })).status, 403);
  for (const path of ['/book/cut', '/book/details']) assert.equal((await nosy.context.request.get(`${app.base}${path}`)).status(), 404, path);
  assert.equal((await nosy.post('/book/hold', { service: 'cut', staff: 'any', date: '2026-11-20', time: '10:00' })).status, 404);
  await nosy.context.close();
});
