// The fire company's gifts on PayPal once its settings are there (the kit's test page until
// then), by one setting. PayPal is faked here (its calls are the kit's, tested there); the trip
// is real.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { start, stop } from './helpers.js';
import { served } from './http-client.js';

const dir = mkdtempSync(join(tmpdir(), 'front-desk-pay-'));
for (const one of ['a', 'b']) mkdirSync(join(dir, one));
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
