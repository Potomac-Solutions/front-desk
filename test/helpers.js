import assert from 'node:assert/strict';
// What both walks share: a server on a free port, a browser, and a "device" (one person's
// browser context) that can also post forms and read the Sync log directly.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createApp } from '../server.js';

// A redirect's location as words: the signature on its message (kit/notice) checked and taken off.
const plain = (location) => {
  location = String(location ?? '');
  if (/[?&](problem|done)=/.test(location) && !location.startsWith('?')) assert.match(location, /&sig=[\w-]{22}/, `unsigned message: ${location}`);
  return decodeURIComponent(location.replace(/&sig=[\w-]+/, '').replaceAll('+', ' '));
};

/** The owner every test business starts with. */
export const OWNER = { email: 'owner@example.com', name: 'Test Owner', password: 'test owner password' };
/** Cheap password hashing for tests. */
export const STAFF_COST = { N: 2 ** 10, r: 8, p: 1 };

/** One business (`site`) on its own server at localhost, with an owner already set up. */
export async function start(dir, site, { name = site, ...options } = {}) {
  const server = await createApp({ tenants: [{ id: name, site, hosts: ['localhost'] }], dataDir: dir, cache: false, secret: 'test-only-secret-that-is-long-enough-1234', staffCost: STAFF_COST, ...options });
  const [link] = await server.open();
  const space = await server.business(name);
  const made = await space.staff.accept(link.token, OWNER);
  if (!made.ok) throw new Error(made.error);
  Object.assign(server, { desk: space.desk, staff: space.staff });
  await new Promise((done) => server.listen(0, done));
  return { server, base: `http://localhost:${server.address().port}` };
}
export function stop(server) {
  server.closeAllConnections?.();
  return new Promise((done) => server.close(done));
}
export function launch(chromium) {
  const system = ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((path) => existsSync(path));
  return chromium.launch().catch(() => chromium.launch({ executablePath: process.env.CHROME ?? system }));
}

export async function device(browser, errors, site, name, { javaScriptEnabled = true, staff = false } = {}) {
  const context = await browser.newContext({ javaScriptEnabled });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(`${name}: ${error.message}`));
  page.on('console', (message) => message.type() === 'error' && !/403/.test(message.text()) && errors.push(`${name}: ${message.text()}`));
  await page.goto(site.base);
  // Sent on to the test payment page (standing in for PayPal's or Clover's): "Pay", or for the declining
  // card "Go back without paying", then the way back.
  const post = async (path, form, headers = {}) => {
    const response = await context.request.post(`${site.base}${path}`, { form, headers, maxRedirects: 0 });
    const location = plain(response.headers().location ?? '');
    if (!location.startsWith('/pay/test')) return { status: response.status(), location };
    const page = await (await context.request.get(`${site.base}${location}`)).text();
    assert.match(page, /Once (PayPal|Clover) is set up, this page is \1’s own\./);
    const ref = new URL(location, site.base).searchParams.get('ref');
    const next = String(form.card ?? '').replace(/\D/g, '') === '4000000000000002'
      ? /href="([^"]+)">Go back without paying/.exec(page)[1].replaceAll('&amp;', '&')
      : (await context.request.post(`${site.base}/pay/test`, { form: { ref, answer: 'pay' }, maxRedirects: 0 })).headers().location;
    const back = await context.request.get(new URL(next, site.base).href, { maxRedirects: 0 });
    return { status: back.status(), location: plain(back.headers().location ?? '') };
  };
  const get = async (path) => (await context.request.get(`${site.base}${path}`)).text();
  /** Every change the log will send this page, asking for `collections` and more. */
  async function pullAll(collections) {
    const scope = Object.fromEntries([...collections, 'busy', 'events', 'funds'].map((one) => [one, true]));
    const all = [];
    for (let since = 0, i = 0; i < 200; i++) {
      const answer = await (await context.request.get(`${site.base}/_zb/sync/pull?since=${encodeURIComponent(since)}&scope=${encodeURIComponent(JSON.stringify(scope))}`)).json();
      all.push(...(answer.changes ?? []));
      if (!answer.changes?.length || answer.cursor === since) break;
      since = answer.cursor;
    }
    return all;
  }
  /** A page trying to write a document itself: the status the log answers. */
  async function push(collection, key, field, value) {
    const response = await context.request.post(`${site.base}/_zb/sync/push`, {
      headers: { 'sec-fetch-site': 'same-origin' },
      data: { changes: [{ collection, key, field, value, clock: `${String(Date.now()).padStart(15, '0')}-00000-x` }] },
    });
    return response.status();
  }
  if (staff) {
    const signedIn = await post('/staff/sign-in', { email: OWNER.email, password: OWNER.password });
    if (signedIn.location !== '/staff') throw new Error(`staff sign-in: ${signedIn.location}`);
  }
  return { context, page, post, get, pullAll, push };
}
