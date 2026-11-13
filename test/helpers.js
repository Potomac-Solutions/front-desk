// What both walks share: a server on a free port, a browser, and a "device" (one person's
// browser context) that can also post forms and read the Sync log directly.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createApp } from '../server.js';

export async function start(dir, site, { name = site, ...options } = {}) {
  const server = await createApp({ site, db: join(dir, `${name}.db`), cache: false, secret: 'test', ...options });
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
  const post = async (path, form, headers = {}) => {
    const response = await context.request.post(`${site.base}${path}`, { form, headers, maxRedirects: 0 });
    return { status: response.status(), location: decodeURIComponent(response.headers().location ?? '') };
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
  if (staff) await post('/staff/start', {});
  return { context, page, post, get, pullAll, push };
}
