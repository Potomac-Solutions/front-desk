// The fire company's gifts on PayPal, and the salon's colour deposits on Clover, once their
// settings are there (the kit's test page until then). The platforms are faked here (their
// calls are the kit's, tested there); the trip is real.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { start, stop } from './helpers.js';
import { served } from './http-client.js';

const dir = mkdtempSync(join(tmpdir(), 'front-desk-pay-'));
for (const one of ['a', 'b', 'c', 'd']) mkdirSync(join(dir, one));
after(() => rmSync(dir, { recursive: true, force: true }));

function fakePayPal() {
  const state = { status: 'CREATED', captures: 0, amount: '0.00', made: [] };
  const fetcher = async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path === '/v1/oauth2/token') return Response.json({ access_token: 'A', expires_in: 3600 });
    if (path === '/v2/checkout/orders') {
      const body = JSON.parse(String(init.body));
      state.made.push(body);
      state.amount = body.purchase_units[0].amount.value;
      return Response.json({ id: 'GIFT1', status: 'CREATED', links: [{ rel: 'payer-action', href: 'https://www.sandbox.paypal.com/checkoutnow?token=GIFT1' }] }, { status: 201 });
    }
    const captured = () => ({ id: 'GIFT1', status: 'COMPLETED', purchase_units: [{ payments: { captures: [{ id: 'CAPG', status: 'COMPLETED', amount: { value: state.amount, currency_code: 'USD' } }] } }] });
    if (path === '/v2/checkout/orders/GIFT1') return Response.json(state.status === 'COMPLETED' ? captured() : { id: 'GIFT1', status: state.status });
    if (path === '/v2/checkout/orders/GIFT1/capture') return (state.captures++, (state.status = 'COMPLETED'), Response.json(captured(), { status: 201 }));
    return new Response('{}', { status: 404 });
  };
  return { fetcher, state };
}

test('a gift on PayPal: approved there, taken once on the way back, the fund moves once', async () => {
  const paypal = fakePayPal();
  const app = await start(join(dir, 'a'), 'community', { payEnv: { PAY_PAYPAL_CLIENT: 'c', PAY_PAYPAL_SECRET: 's', PAY_PAYPAL_SANDBOX: '1' }, payFetch: paypal.fetcher });
  const giver = await served(app.server);
  try {
    assert.equal(app.server.payments.name, 'paypal');
    const page = (await giver.call('/give')).text;
    assert.match(page, /You’ll pay on PayPal’s secure page, in its test mode: no money moves\. We never see your card number\./);
    assert.doesNotMatch(page, /name="card"/);
    const gift = /name="gift" value="(g[a-z0-9]+)"/.exec(page)[1];
    const before = app.server.desk.fund().raised;
    const sent = await giver.post('/give', { gift, amount: '5000', name: 'Rosa Bittinger', email: 'rosa@example.com' });
    assert.equal(sent.location, 'https://www.sandbox.paypal.com/checkoutnow?token=GIFT1');
    assert.equal(paypal.state.made[0].purchase_units[0].amount.value, '50.00');
    paypal.state.status = 'APPROVED';
    assert.equal((await giver.call(`/pay/back?gift=${gift}`)).location, '/give?done=Thank you for your gift of $50.00.');
    assert.equal((await giver.call(`/pay/back?gift=${gift}`)).location, '/give?done=Thank you for your gift of $50.00.', 'back twice: once');
    const webhook = await giver.call('/pay/webhook', { method: 'POST', body: JSON.stringify({ event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { supplementary_data: { related_ids: { order_id: 'GIFT1' } } } }) });
    assert.equal(webhook.status, 200);
    assert.equal(paypal.state.captures, 1);
    assert.equal(app.server.desk.fund().raised, before + 5000);
    assert.equal(app.server.desk.gifts().length, 1);
  } finally {
    await stop(app.server);
  }
});

test('backed out of PayPal: nothing given, and PayPal is never told to take it afterwards', async () => {
  const paypal = fakePayPal();
  const app = await start(join(dir, 'b'), 'community', { payEnv: { PAY_PAYPAL_CLIENT: 'c', PAY_PAYPAL_SECRET: 's', PAY_PAYPAL_SANDBOX: '1' }, payFetch: paypal.fetcher });
  const giver = await served(app.server);
  try {
    const gift = /name="gift" value="(g[a-z0-9]+)"/.exec((await giver.call('/give')).text)[1];
    await giver.post('/give', { gift, amount: '5000', name: 'Rosa', email: '' });
    assert.equal((await giver.call(`/pay/cancel?gift=${gift}`)).location, '/give?problem=Nothing was charged.');
    paypal.state.status = 'APPROVED';
    assert.match((await giver.call(`/pay/back?gift=${gift}`)).location, /^\/give\?problem=/);
    assert.equal(paypal.state.captures, 0);
    assert.equal(app.server.desk.gifts().length, 0);
  } finally {
    await stop(app.server);
  }
});

// ---- The salon's colour deposit on Clover ---------------------------------------------------------

const CLOVER = { PAY_CLOVER_MERCHANT: 'MID', PAY_CLOVER_KEY: 'PRIV', PAY_CLOVER_WEBHOOK_SECRET: 'clover-webhook-secret', PAY_CLOVER_SANDBOX: '1' };

function fakeClover() {
  const state = { made: [], refunds: [] };
  const fetcher = async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path === '/invoicingcheckoutservice/v1/checkouts') {
      state.made.push({ headers: init.headers, body: JSON.parse(String(init.body)) });
      const id = `CS${state.made.length}`;
      return Response.json({ checkoutSessionId: id, href: `https://sandbox.dev.clover.com/checkout/${id}`, expirationTime: Date.now() + 15 * 60_000 });
    }
    if (path === '/v1/refunds') return (state.refunds.push(JSON.parse(String(init.body))), Response.json({ id: `RF${state.refunds.length}` }));
    return new Response('{}', { status: 404 });
  };
  return { fetcher, state };
}
/** Clover's webhook for a checkout session, signed as Clover signs it. */
function cloverSays(session, { status = 'APPROVED', secret = CLOVER.PAY_CLOVER_WEBHOOK_SECRET } = {}) {
  const body = JSON.stringify({ created: Date.now(), message: `${status === 'APPROVED' ? 'Approved' : 'Declined'} for 2500`, status, type: 'PAYMENT', id: `PAY-${session}`, merchantId: 'MID', data: session });
  const stamp = String(Math.floor(Date.now() / 1000));
  return { method: 'POST', headers: { 'content-type': 'application/json', 'clover-signature': `t=${stamp},v1=${createHmac('sha256', secret).update(`${stamp}.${body}`).digest('hex')}` }, body };
}
function colourTime(desk, skip = 0) {
  for (const { date } of desk.days('colour', 'jess')) {
    const free = desk.times('colour', 'jess', date).filter((one) => one.free);
    if (free.length > skip + 2) return { date, time: free[skip].time };
  }
  throw new Error('no free day');
}
const ann = { name: 'Ann Teets', phone: '301-555-0101', email: 'ann@example.com', patch: 'No', last: 'Never' };

test('a colour on Clover: the deposit on Clover’s page, booked when Clover’s signed webhook says so, once', async () => {
  const clover = fakeClover();
  const app = await start(join(dir, 'c'), 'desk', { payEnv: CLOVER, payFetch: clover.fetcher });
  const guest = await served(app.server);
  try {
    assert.equal(app.server.payments.name, 'clover');
    const at = colourTime(app.server.desk);
    assert.equal((await guest.post('/book/hold', { service: 'colour', staff: 'jess', ...at })).location, '/book/details');
    assert.match((await guest.call('/book/details')).text, /Colour takes a \$25\.00 deposit to book\. It comes off the bill, and comes back if you cancel\. You’ll pay on Clover’s secure page, in its test mode: no money moves\./);
    const sent = await guest.post('/book/details', ann);
    assert.equal(sent.location, 'https://sandbox.dev.clover.com/checkout/CS1');
    const made = clover.state.made[0];
    assert.equal(made.headers['x-clover-merchant-id'], 'MID');
    assert.equal(made.body.shoppingCart.lineItems[0].price, 2500);
    const key = /appt=(a[a-z0-9]+)/.exec(made.body.redirectUrls.success)[1];
    assert.equal(made.body.redirectUrls.success, `${guest.base}/pay/back?appt=${key}`);
    // The chair is the guest's while they pay.
    assert.equal(app.server.desk.times('colour', 'jess', at.date).find((one) => one.time === at.time).free, false);

    // Back before Clover's webhook: not booked yet, and a page that looks again by itself.
    const early = await guest.call(`/pay/back?appt=${key}`);
    assert.equal(early.status, 202);
    assert.match(early.text, /Confirming your deposit/);
    assert.equal(early.headers.get('refresh'), `3;url=/pay/back?appt=${key}&try=1`);
    assert.equal(app.server.desk.store.get('appointments', key).status, 'paying');
    assert.equal(app.server.desk.store.under('messages').length, 0, 'no text until the deposit is in');

    // Only a webhook Clover signed counts; a page can't say it paid.
    assert.equal((await guest.call('/pay/webhook', cloverSays('CS1', { secret: 'not-the-secret' }))).status, 401);
    assert.equal(app.server.desk.store.get('appointments', key).status, 'paying');
    assert.equal((await guest.call('/pay/webhook', cloverSays('CS1'))).status, 200);
    assert.equal(app.server.desk.store.get('appointments', key).status, 'booked');
    assert.equal((await guest.call('/pay/webhook', cloverSays('CS1'))).status, 200, 'sent twice');
    assert.equal((await guest.call(`/pay/back?appt=${key}&try=1`)).location, `/a/${key}?done=Booked. Your deposit is in, and we’ve sent you a text to confirm.`);
    assert.equal(app.server.desk.store.under('messages').filter((one) => /booked for colour/.test(one.body ?? one.text ?? JSON.stringify(one))).length, 2, 'one text and one email, once');

    // Cancelled: the time is free, and the deposit goes back to the card on Clover.
    assert.equal((await guest.post(`/a/${key}/cancel`, {})).location, `/a/${key}?done=Cancelled. The time is free for someone else.`);
    assert.deepEqual(clover.state.refunds, [{ charge: 'PAY-CS1', amount: 2500 }]);
    assert.equal(app.server.desk.store.get('appointments', key).depositRefunded, 2500);
    assert.equal(app.server.desk.times('colour', 'jess', at.date).find((one) => one.time === at.time).free, true);
  } finally {
    await stop(app.server);
  }
});

test('backed out of Clover, or never paid: the time is let go; a deposit that comes in after is given back', async () => {
  const clover = fakeClover();
  let clock = Date.now();
  const app = await start(join(dir, 'd'), 'desk', { payEnv: CLOVER, payFetch: clover.fetcher, now: () => clock });
  const guest = await served(app.server);
  try {
    const at = colourTime(app.server.desk);
    await guest.post('/book/hold', { service: 'colour', staff: 'jess', ...at });
    await guest.post('/book/details', ann);
    const first = /appt=(a[a-z0-9]+)/.exec(clover.state.made[0].body.redirectUrls.failure)[1];
    assert.equal((await guest.call(`/pay/cancel?appt=${first}`)).location, `/book/colour?date=${at.date}&problem=Nothing was charged, and the time is free again.`);
    assert.equal(app.server.desk.times('colour', 'jess', at.date).find((one) => one.time === at.time).free, true);
    assert.match((await guest.call(`/a/${first}`)).text, /Not booked[\s\S]*Nothing was kept/);
    // Clover's word arrives after all: it's given back, and the time stays free.
    await guest.call('/pay/webhook', cloverSays('CS1'));
    assert.deepEqual(clover.state.refunds, [{ charge: 'PAY-CS1', amount: 2500 }]);
    assert.equal(app.server.desk.store.get('appointments', first).status, 'let-go');

    // Paying, and the page left open past half an hour: the sweep lets the time go.
    await guest.post('/book/hold', { service: 'colour', staff: 'jess', ...at });
    await guest.post('/book/details', ann);
    const second = /appt=(a[a-z0-9]+)/.exec(clover.state.made[1].body.redirectUrls.success)[1];
    clock += 31 * 60_000;
    await app.server.desk.sweep();
    assert.equal(app.server.desk.store.get('appointments', second).status, 'let-go');
    assert.equal(app.server.desk.times('colour', 'jess', at.date).find((one) => one.time === at.time).free, true);
    // A cut takes no deposit: booked at once.
    const cut = app.server.desk.days('cut', 'any').find(({ free }) => free).date;
    const time = app.server.desk.times('cut', 'any', cut).find((one) => one.free).time;
    await guest.post('/book/hold', { service: 'cut', staff: 'any', date: cut, time });
    assert.match((await guest.post('/book/details', { name: 'Bo Fike', phone: '240-555-0199', length: 'A trim' })).location, /^\/a\/a[a-z0-9]+\?done=Booked/);
    assert.equal(clover.state.made.length, 2);
  } finally {
    await stop(app.server);
  }
});
