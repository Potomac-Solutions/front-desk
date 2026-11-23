// Front Desk and Community: one small Node server for an office or a community group.
//
// - Appointments: choose a service, who, a day and a time; the time is held while the guest
//   fills in the details, then booked; free times grey out live on every page.
// - Events: a calendar, with places that count down live as people sign up.
// - Giving: a fund whose total moves live with every gift (test-mode payments).
// - Forms: an enquiry, a quote request or a sign-up sheet, to the staff inbox.
// - Every form is a plain post to a route here, so it all works without JavaScript.
// - One server runs several businesses, each chosen by the request's host name (the kit's
//   tenancy), each with its own log and its own staff. A business's site (src/site.js) switches
//   its modules on. The deciding is the kit's (src/desk.js): hold, pay, notify.
// - Staff sign in with their own accounts (the kit's staff module): an owner, the people they
//   invite, roles, sessions that end.
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createZubra } from '@zubra/server';
import { signedCookie } from '@potomac-solutions/kit/auth';
import { createStaff } from '@potomac-solutions/kit/staff';
import { staffPages, clientAddress } from '@potomac-solutions/kit/staff/pages';
import { createCustomers } from '@potomac-solutions/kit/customers';
import * as accountPages from './src/account.js';
import { createAdmin } from './src/admin.js';
import { lockedStaff, lockedCustomers, demoSignIn, guestSignIn, nightly } from './src/demo.js';
import { createNotices } from '@potomac-solutions/kit/notice';
import { createTenants } from '@potomac-solutions/kit/tenant';
import { createTenancy } from '@potomac-solutions/kit/tenancy';
import { createDesk, deskSync, CONTACT, timeLabel, dateLabel } from './src/desk.js';
import { sites } from './src/site.js';
import { layout, escape } from './src/layout.js';
import { shell } from './src/shell.js';
import { landing } from './src/home.js';
import { cards } from './src/tables.js';
import { serveAsset } from './src/assets.js';

/** The staff's pages, for marking where they are in the sidebar. */
const STAFF_LINKS = ['/staff', '/admin', '/admin/appointments', '/admin/events', '/admin/gifts', '/admin/inbox', '/admin/customers', '/admin/reports', '/admin/settings', '/admin/outbox', '/staff/people'];

const here = dirname(fileURLToPath(import.meta.url));
const components = join(here, 'src', 'components');
const dollars = (cents) => `$${(cents / 100).toFixed(2)}`;
const plainDollars = (cents) => `$${(cents / 100).toLocaleString('en-US')}`;
const dayKey = (date) => date.replaceAll('-', '');

/**
 * The businesses one server runs: an id, its site (src/site.js) and the host names it answers to.
 * In production, set TENANTS to a JSON list of these. Locally, the salon answers at localhost and
 * the fire company at 127.0.0.1 (or salon.localhost and firehall.localhost, in a browser).
 */
export const DEFAULT_TENANTS = [
  { id: 'yough-valley-hair', site: 'desk', hosts: ['localhost', 'salon.localhost'] },
  { id: 'pine-hollow-vfc', site: 'community', hosts: ['127.0.0.1', 'firehall.localhost'] },
];
const tenantsFromEnv = () => (process.env.TENANTS ? JSON.parse(process.env.TENANTS) : null);

export async function createApp({
  tenants = tenantsFromEnv() ?? DEFAULT_TENANTS,
  dataDir = process.env.DATA_DIR ?? here,
  cache = true,
  secret = process.env.SESSION_SECRET,
  secure = process.env.NODE_ENV === 'production',
  now = Date.now,
  holdMs,
  staffCost,
  // How many proxies in front add to X-Forwarded-For (1 on Railway), so sign-in counts failures by
  // the real address. 0 trusts no header.
  proxies = Number(process.env.TRUST_PROXIES ?? 0),
  // The public demo (src/demo.js): the seeded businesses, with their sign-ins shown and protected.
  demo = process.env.DEMO === '1',
} = {}) {
  if (!secret) {
    if (process.env.NODE_ENV === 'production') throw new Error('Set SESSION_SECRET.');
    secret = 'front-desk-development-only';
  }
  for (const tenant of tenants) if (!sites[tenant.site]) throw new TypeError(`${tenant.id}: no site called ${tenant.site}`);
  const directory = createTenants({ tenants });
  // Each business: its own log (a SQLite file), its desk and its staff, opened the first time
  // it's asked for.
  const tenancy = createTenancy({
    tenants: directory,
    open: (tenant) => deskSync({ db: dataDir === ':memory:' ? ':memory:' : join(dataDir, `${tenant.id}.db`) }),
    setup: async ({ tenant, sync, store }) => {
      const desk = await createDesk({ sync, store, site: tenant.site, now, holdMs });
      const staff = createStaff({ store, secure, now, ...(staffCost ? { cost: staffCost } : {}) });
      // Customers who make an account (kit/customers), in the business's own log.
      const customers = createCustomers({ store, secure, now, ...(staffCost ? { cost: staffCost } : {}) });
      return { desk, customers: demo ? lockedCustomers(customers) : customers, staff: demo ? lockedStaff(staff, tenant.site) : staff };
    },
  });
  const guests = signedCookie({ secret, name: 'guest', secure });
  const zubra = createZubra({ components, cache });

  /** One business's pages and routes. */
  function business({ desk, staff, customers }) {
  const { on } = desk;
  const site = desk.site;
  const clockAt = (at) => new Date(at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: site.timeZone }).toLowerCase();

  const send = (res, status, html) => (res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' }), res.end(html));
  // A message in an address shows only if the server signed it (kit/notice), so a link can't put
  // its own words in a page's alert.
  const notices = createNotices({ secret });
  const back = (res, location) => (res.writeHead(303, { location: notices.sign(location) }), res.end());
  const page = (res, p, title, body, options = {}) => send(res, options.status ?? 200, p.finish(layout({ title, site, body, ...options })));
  // The staff's pages sit in their own frame (src/shell.js), with tables that fit a phone.
  const shellPage = (res, p, title, body, options = {}) => send(res, options.status ?? 200, p.finish(shell({ title, site, body: cards(body), owner: staff.can(res.who, 'owner'), waiting: desk.inbox().filter((one) => !one.handled).length, here: options.here ?? '' })));
  const admin = createAdmin({ desk, customers, now });
  const downloadCsv = (res, name, text) => (res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${name}"`, 'cache-control': 'no-store' }), res.end(text));
  const origin = (req) => process.env.PUBLIC_URL || `http://${req.headers.host ?? 'localhost'}`;
  const note = (url) => {
    const problem = notices.read(url).problem;
    const done = notices.read(url).done;
    return `${problem ? `<p class="notice" role="alert">${escape(problem)}</p>` : ''}${done ? `<p class="ok" role="status">${escape(done)}</p>` : ''}`;
  };
  const withProblem = (path, answer) => `${path}${path.includes('?') ? '&' : '?'}problem=${encodeURIComponent(answer.error)}`;
  const withDone = (path, words) => `${path}${path.includes('?') ? '&' : '?'}done=${encodeURIComponent(words)}`;
  async function readForm(req) {
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 20_000) return null;
    }
    return new URLSearchParams(body);
  }

  /** One field of a form, from its description in src/site.js. */
  function field(one) {
    const id = `f-${one.name}`;
    const required = one.required ? ' required' : '';
    const hint = one.hint ? `<span class="hint">${escape(one.hint)}</span>` : '';
    if (one.type === 'checkbox') return `<label class="check"><input type="checkbox" id="${id}" name="${one.name}" value="yes"${required}> ${escape(one.label)}</label>`;
    let control;
    if (one.type === 'select') control = `<select id="${id}" name="${one.name}"${required}><option value="">Choose…</option>${one.options.map((option) => `<option>${escape(option)}</option>`).join('')}</select>`;
    else if (one.type === 'textarea') control = `<textarea id="${id}" name="${one.name}" rows="4" maxlength="2000"${required}></textarea>`;
    else {
      const extra = one.type === 'number' ? ` min="${one.min ?? 0}" max="${one.max ?? 1e6}" inputmode="numeric"` : one.type === 'tel' ? ' autocomplete="tel"' : one.type === 'email' ? ' autocomplete="email"' : one.name === 'name' ? ' autocomplete="name"' : '';
      control = `<input type="${one.type}" id="${id}" name="${one.name}" maxlength="200"${extra}${required}>`;
    }
    return `<label for="${id}">${escape(one.label)}${hint}${control}</label>`;
  }
  const fields = (list) => `<div class="fields">${list.map(field).join('')}</div>`;
  const answersList = (answers) => (answers?.length ? `<dl>${answers.map(([label, value]) => `<dt>${escape(label)}</dt><dd>${escape(value)}</dd>`).join('')}</dl>` : '');
  const eventWhen = (event) => `${dateLabel(event.date)}, ${timeLabel(event.starts)} to ${timeLabel(event.ends)}`;
  const placesLeft = (p, event) => p.render('places-left', { event: event.key, capacity: event.capacity ?? 0, leftNow: event.left ?? 0 });
  const fundBar = (p, fund) => p.render('fund-progress', { fund: fund.id, goal: fund.goal, raisedNow: fund.raised, giftsNow: fund.gifts });

  // ---- The guest's pages ----------------------------------------------------------------------------
  function home(p, url, guest, account) {
    const fund = desk.fund();
    return landing({
      site,
      mine: desk.appointmentsFor(guest),
      signed: on.events ? desk.rsvpsFor(guest) : [],
      fund,
      fundBar: fund ? fundBar(p, fund) : '',
      eventCards: on.events ? desk.events().slice(0, 3).map((event) => eventCard(p, event)).join('') : '',
      said: note(url),
      account,
    });
  }

  function bookPage(p, url, guest, svc) {
    const staffChoice = desk.person(url.searchParams.get('staff')) && svc.id && desk.staffFor(svc.id).some((one) => one.id === url.searchParams.get('staff')) ? url.searchParams.get('staff') : 'any';
    const days = desk.days(svc.id, staffChoice);
    const asked = url.searchParams.get('date');
    const day = days.find((one) => one.date === asked) ?? days.find((one) => one.free) ?? days[0];
    const link = (staffId, date) => `/book/${svc.id}?staff=${staffId}${date ? `&date=${date}` : ''}`;
    const holding = desk.pending(guest);
    const choices = [{ id: 'any', name: 'Anyone' }, ...desk.staffFor(svc.id)];
    return `<section class="page-head"><h1>${escape(svc.name)}</h1><p class="lede">${svc.minutes} minutes · ${escape(svc.price)} · ${escape(svc.about)}</p></section>
${note(url)}
${holding?.until ? `<p class="bulletin">You’re holding ${escape(dateLabel(holding.date))} at ${escape(timeLabel(holding.time))}. <a href="/book/details">Finish booking it</a>, or choose another time below.</p>` : ''}
<section class="panel"><h2>With</h2><ul class="days">${choices.map((one) => `<li><a href="${link(one.id, day?.date)}"${one.id === staffChoice ? ' aria-current="true"' : ''}>${escape(one.name)}</a></li>`).join('')}</ul></section>
<section class="panel"><h2>Day</h2>${days.length ? `<ul class="days">${days.map((one) => `<li><a href="${link(staffChoice, one.date)}"${one.date === day.date ? ' aria-current="date"' : ''}>${escape(one.label)}<small>${one.free ? `${one.free} free` : 'Full'}</small></a></li>`).join('')}</ul>` : '<p>Nobody does this in the next two weeks. Call us.</p>'}</section>
${day ? `<section class="panel"><h2>${escape(day.label)}: choose a time</h2><p class="hint">We’ll hold it for ${site.holdMinutes} minutes while you fill in your details.</p>${p.render('free-times', {
      day: dayKey(day.date),
      date: day.date,
      service: svc.id,
      staff: staffChoice,
      action: '/book/hold',
      starts: desk.times(svc.id, staffChoice, day.date),
      who: desk.whoCan(svc.id, staffChoice, day.date).map(({ id, opens, closes }) => ({ id, opens, closes })),
      minutes: svc.minutes,
      slot: site.slotMinutes,
      takenNow: desk.busyOn(day.date),
    })}</section>` : ''}`;
  }

  function detailsPage(p, url, holding) {
    const svc = desk.service(holding.service);
    return `<section class="page-head"><h1>Your details</h1><p class="lede">${escape(svc.name)} with ${escape(desk.person(holding.staff).name)}, ${escape(dateLabel(holding.date))} at ${escape(timeLabel(holding.time))}.</p></section>
${note(url)}
<p class="bulletin">${holding.until ? `Held for you until ${escape(clockAt(holding.until))}.` : 'Your hold ran out, but you can still book it if nobody has taken it.'}</p>
<form class="panel" method="post" action="/book/details">${fields([...CONTACT, ...svc.intake])}<button type="submit">Book it</button></form>
<form method="post" action="/book/letgo"><button class="button light" type="submit">Let this time go</button></form>`;
  }

  function appointmentPage(url, appt) {
    const cancelled = appt.status === 'cancelled';
    return `<section class="page-head"><h1>${cancelled ? 'Cancelled' : 'You’re booked'}</h1><p class="lede">${escape(appt.what[0].toUpperCase() + appt.what.slice(1))}, ${escape(appt.when)}.</p></section>
${note(url)}
<section class="panel"><dl><dt>Name</dt><dd>${escape(appt.name)}</dd><dt>Phone</dt><dd>${escape(appt.phone)}</dd>${appt.email ? `<dt>Email</dt><dd>${escape(appt.email)}</dd>` : ''}</dl>${answersList(appt.answers)}</section>
${cancelled ? `<p><a class="go" href="/book/${appt.service}">Book another time</a></p>` : `<form method="post" action="/a/${appt.key}/cancel"><button class="button light" type="submit">Cancel this appointment</button></form>`}`;
  }

  function eventCard(p, event) {
    return `<li class="card"><p class="meta">${escape(eventWhen(event))}</p><h3><a href="/events/${event.key}">${escape(event.title)}</a></h3><p>${escape(event.place)}</p>${placesLeft(p, event)}</li>`;
  }

  function calendarPage(p, url) {
    const months = new Map();
    for (const event of desk.events()) {
      const month = new Date(`${event.date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
      months.set(month, [...(months.get(month) ?? []), event]);
    }
    return `<section class="page-head"><h1>Calendar</h1><p class="lede">What’s on at ${escape(site.name)}.</p></section>
${note(url)}
${[...months].map(([month, events]) => `<h2 class="month">${escape(month)}</h2><ul class="cards">${events.map((event) => eventCard(p, event)).join('')}</ul>`).join('') || '<p>Nothing on the calendar yet.</p>'}`;
  }

  function eventPage(p, url, guest, event) {
    const mine = desk.rsvpsFor(guest).find((one) => one.event === event.key);
    let signUp = '<p class="bulletin">No need to sign up. Just come.</p>';
    if (mine) signUp = `<p class="ok">You’re signed up for ${mine.count} ${mine.count === 1 ? 'place' : 'places'}. <a href="/r/${mine.key}">Your sign-up</a></p>`;
    else if (event.capacity)
      signUp = `<form class="panel" method="post" action="/events/${event.key}/signup"><h2>Sign up</h2>${fields([{ name: 'count', label: 'How many places', type: 'number', min: 1, max: site.partyMax, required: true }, ...CONTACT])}<button type="submit">Sign up</button></form>`;
    return `<section><p class="meta">${escape(eventWhen(event))}</p><h1>${escape(event.title)}</h1><p class="lede">${escape(event.place)}</p></section>
${note(url)}
${placesLeft(p, event)}
<p>${escape(event.about)}</p>
${signUp}`;
  }

  function rsvpPage(p, url, rsvp) {
    const cancelled = rsvp.status === 'cancelled';
    return `<section class="page-head"><h1>${cancelled ? 'Cancelled' : 'You’re signed up'}</h1><p class="lede">${escape(rsvp.event.title)}, ${escape(eventWhen(rsvp.event))}. ${rsvp.count} ${rsvp.count === 1 ? 'place' : 'places'}, for ${escape(rsvp.name)}.</p></section>
${note(url)}
${placesLeft(p, rsvp.event)}
${cancelled ? `<p><a class="go" href="/events/${rsvp.event.key}">Sign up again</a></p>` : `<form method="post" action="/r/${rsvp.key}/cancel"><button class="button light" type="submit">Cancel, and give the places back</button></form>`}`;
  }

  function givePage(p, url) {
    const fund = desk.fund();
    return `<section class="page-head"><h1>Give to ${escape(fund.title.replace(/^The /, 'the '))}</h1><p class="lede">${escape(site.fund.about)}</p></section>
${note(url)}
<section class="panel">${fundBar(p, fund)}</section>
<form class="panel" method="post" action="/give">
  <input type="hidden" name="gift" value="${desk.newKey('g')}">
  <fieldset class="fields" style="border:0;padding:0;margin:0"><legend><strong>Amount</strong></legend>
  <div class="row">${site.givingAmounts.map((cents, i) => `<label class="check"><input type="radio" name="amount" value="${cents}"${i === 1 ? ' checked' : ''}> ${plainDollars(cents)}</label>`).join('')}</div>
  <label for="f-other">Or another amount, in dollars<input id="f-other" name="other" inputmode="decimal" maxlength="12"></label></fieldset>
  ${fields([{ name: 'name', label: 'Your name', type: 'text', required: true }, { name: 'email', label: 'Email, for a receipt', type: 'email' }])}
  <label for="f-card">Card number<span class="hint">Test mode: nothing is charged. Any number works; 4000 0000 0000 0002 is declined.</span><input id="f-card" name="card" inputmode="numeric" autocomplete="cc-number" required></label>
  <button type="submit">Give</button>
</form>`;
  }

  function formPage(url, form) {
    return `<section class="page-head"><h1>${escape(form.title)}</h1><p class="lede">${escape(form.intro)}</p></section>
${note(url)}
<form class="panel" method="post" action="/forms/${form.id}">${fields(form.fields)}<button type="submit">Send</button></form>`;
  }

  // ---- The staff's page --------------------------------------------------------------------------------
  function staffPage(p, url) {
    const parts = [`<section class="page-head"><h1>${on.appointments ? 'The front desk' : 'The office'}</h1><p class="lede">Everything people have booked, signed up for, given and sent.</p></section>`, note(url)];
    if (on.appointments) {
      const days = desk.upcoming().filter(({ day }) => site.staff.some((one) => one.days.includes(day)));
      const day = days.find((one) => one.date === url.searchParams.get('day'))?.date ?? days[0].date;
      const sheet = desk.daySheet(day);
      parts.push(`<section class="panel"><h2>Appointments</h2><ul class="days">${days.map((one) => `<li><a href="/staff?day=${one.date}"${one.date === day ? ' aria-current="date"' : ''}>${escape(dateLabel(one.date))}</a></li>`).join('')}</ul>
${sheet.map((one) => `<h3>${escape(one.name)}</h3>${one.appointments.length ? `<table><tbody>${one.appointments.map((appt) => `<tr><td>${escape(timeLabel(appt.time))}</td><td><strong>${escape(desk.service(appt.service).name)}</strong><br>${escape(appt.name)}, ${escape(appt.phone)}${answersList(appt.answers)}</td><td><form method="post" action="/staff/cancel"><input type="hidden" name="key" value="${appt.key}"><button class="button light" type="submit">Cancel</button></form></td></tr>`).join('')}</tbody></table>` : '<p>Nothing booked.</p>'}`).join('')}</section>`);
    }
    if (on.events) {
      parts.push(`<section class="panel"><h2>Sign-ups</h2>${desk
        .events()
        .filter((event) => event.capacity)
        .map((event) => {
          const list = desk.rsvpsAt(event.key);
          return `<h3>${escape(event.title)}, ${escape(dateLabel(event.date))}</h3>${placesLeft(p, event)}${list.length ? `<ul>${list.map((one) => `<li>${escape(one.name)}, ${escape(one.phone)} · ${one.count}</li>`).join('')}</ul>` : '<p>Nobody yet.</p>'}`;
        })
        .join('')}</section>`);
    }
    if (on.giving) {
      const gifts = desk.gifts().slice(0, 15);
      parts.push(`<section class="panel"><h2>Giving</h2>${fundBar(p, desk.fund())}${gifts.length ? `<table><tbody>${gifts.map((gift) => `<tr><td>${escape(gift.name)}</td><td>${dollars(gift.cents)}</td><td>${escape(gift.ref)}</td></tr>`).join('')}</tbody></table>` : '<p>No gifts online yet.</p>'}</section>`);
    }
    const inbox = desk.inbox();
    parts.push(`<section class="panel"><h2>Inbox</h2>${inbox.length ? `<ul>${inbox.map((one) => `<li class="${one.handled ? 'done' : ''}"><strong>${escape(one.title)}</strong>${answersList(one.answers)}${one.handled ? '<small>Handled</small>' : `<form method="post" action="/staff/handled"><input type="hidden" name="key" value="${one.key}"><button class="button light" type="submit">Mark handled</button></form>`}</li>`).join('')}</ul>` : '<p>Nothing yet.</p>'}</section>`);
    const sent = desk.messages().slice(0, 15);
    parts.push(`<section class="panel"><h2>Texts and emails sent</h2><p class="hint">In the concept nothing is really sent; each message is kept here.</p>${sent.length ? `<ul>${sent.map((one) => `<li><strong>${escape(one.channel === 'sms' ? 'Text' : 'Email')} to ${escape(one.to)}</strong>: ${escape(one.body)}</li>`).join('')}</ul>` : '<p>None yet.</p>'}</section>`);
    return parts.join('\n');
  }

  // ---- Staff accounts: sign-in, links, people and passwords (the kit's pages) -------------------
  const pages = staffPages({ staff, notices, proxies, home: '/staff', business: site.name, secure, // A signed-in member of staff sees the kit's pages (people, their password) inside the staff frame;
    // signing in and accepting an invite are a narrow card on the business's own page.
    render: (res, title, body) => (staff.can(res.who, 'staff') ? shellPage(res, zubra.page(), title, body, { here: title === 'People' ? '/staff/people' : '' }) : page(res, zubra.page(), title, `<div class="auth">${body}</div>`)) });

  /** Answer one request for this business. */
  return async function handle(req, res, url, browserGuest) {
    const who = staff.session(req);
    const atDesk = staff.can(who, 'staff');
    const owner = staff.can(who, 'owner');
    // Signed in, a guest's own records are their browser's and their account's.
    const account = customers.session(req);
    const guest = browserGuest && { ...browserGuest, customer: account?.customer };
    const nav = { customer: account, staff: atDesk };
    res.who = who;
    // Staff pages (they pass `wide`) go in the staff frame; the rest in the business's own page.
    const staffHere = () => STAFF_LINKS.filter((href) => url.pathname === href || url.pathname.startsWith(`${href}/`)).sort((a, b) => b.length - a.length)[0] ?? '';
    const show = (p, title, body, { wide = false, ...options } = {}) => (wide ? shellPage(res, p, title, body, { here: staffHere(), ...options }) : page(res, p, title, body, { nav, ...options }));
    if (url.pathname.startsWith('/account') || url.pathname.startsWith('/admin')) res.setHeader('cache-control', 'no-store');
    if (req.method === 'POST') {
      // Every form is ours: another site's post is refused (the cookies are SameSite=Lax too).
      if (req.headers['sec-fetch-site'] === 'cross-site') return send(res, 403, 'Forbidden');
      const form = await readForm(req);
      if (!form) return send(res, 413, 'Too large');
      const path = url.pathname;
      if (on.appointments && path === '/book/hold') {
        const done = await desk.holdTime(guest, form);
        const svc = String(form.get('service') ?? '');
        return back(res, done.ok ? '/book/details' : withProblem(`/book/${encodeURIComponent(svc)}?staff=${encodeURIComponent(String(form.get('staff') ?? 'any'))}&date=${encodeURIComponent(String(form.get('date') ?? ''))}`, done));
      }
      if (on.appointments && path === '/book/letgo') {
        const svc = desk.pending(guest)?.service;
        await desk.letGo(guest);
        return back(res, svc ? `/book/${svc}` : '/');
      }
      if (on.appointments && path === '/book/details') {
        const done = await desk.book(guest, form);
        return back(res, done.ok ? withDone(`/a/${done.key}`, 'Booked. We’ve sent you a text to confirm.') : withProblem(done.back ?? '/book/details', done));
      }
      const cancelling = path.match(/^\/a\/(a[a-z0-9]+)\/cancel$/);
      if (on.appointments && cancelling) {
        const done = await desk.cancel(guest, cancelling[1]);
        return back(res, done.ok ? withDone(`/a/${cancelling[1]}`, 'Cancelled. The time is free for someone else.') : withProblem(`/a/${cancelling[1]}`, done));
      }
      const signing = path.match(/^\/events\/(e[a-z0-9]+)\/signup$/);
      if (on.events && signing) {
        const done = await desk.signUp(guest, signing[1], form);
        return back(res, done.ok ? withDone(`/r/${done.key}`, 'You’re signed up. We’ve sent you a text.') : withProblem(`/events/${signing[1]}`, done));
      }
      const unsigning = path.match(/^\/r\/(r[a-z0-9]+)\/cancel$/);
      if (on.events && unsigning) {
        const done = await desk.cancelRsvp(guest, unsigning[1]);
        return back(res, done.ok ? withDone(`/r/${unsigning[1]}`, 'Cancelled. The places are back for someone else.') : withProblem(`/r/${unsigning[1]}`, done));
      }
      if (on.giving && path === '/give') {
        const done = await desk.give(guest, form);
        return back(res, done.ok ? withDone('/give', `Thank you for your gift of ${dollars(done.cents)}.`) : withProblem('/give', done));
      }
      const sending = path.match(/^\/forms\/([a-z-]+)$/);
      if (sending && desk.form(sending[1])) {
        const done = await desk.send(sending[1], form);
        return back(res, done.ok ? withDone(`/forms/${sending[1]}`, 'Sent. We’ll be in touch.') : withProblem(`/forms/${sending[1]}`, done));
      }
      // A customer's account.
      if (path.startsWith('/account/')) {
        const p = zubra.page();
        const problem = (words) => `<p class="notice" role="alert">${escape(words)}</p>`;
        if (path === '/account/sign-up') {
          const made = await customers.signUp({ email: form.get('email'), name: form.get('name'), password: form.get('password') });
          if (made.error) return show(p, 'Make an account', accountPages.signUp({ problem: problem(made.error), form }), { status: 422 });
          await desk.claim(guest, made.customer);
          res.setHeader('set-cookie', made.cookie);
          return back(res, withDone('/account', 'Welcome. Your account is ready.'));
        }
        if (path === '/account/sign-in') {
          const signed = await customers.signIn(form.get('email'), form.get('password'), { client: clientAddress(req, { proxies }) });
          if (signed.error) return show(p, 'Sign in', (demo ? `<div class="auth">${guestSignIn(escape)}</div>` : '') + accountPages.signIn({ problem: problem(signed.error === 'locked' ? 'Too many tries. Wait 15 minutes, or reset your password.' : 'That email and password don’t match.'), email: String(form.get('email') ?? '') }), { status: 401 });
          await desk.claim(guest, signed.customer);
          res.setHeader('set-cookie', signed.cookie);
          return back(res, '/account');
        }
        if (path === '/account/sign-out') {
          res.setHeader('set-cookie', (await customers.signOut(req)).cookie);
          return back(res, '/');
        }
        if (path === '/account/forgot') {
          const email = String(form.get('email') ?? '').trim().toLowerCase();
          const raw = await customers.resetToken(email);
          const one = raw && customers.list().find((c) => c.email === email);
          if (one) {
            const link = `${origin(req)}/account/reset?token=${raw}`;
            await desk.email(one.email, `Reset your ${site.name} password`, `Hi ${one.name},\n\nThis link sets a new password. It works once, for an hour:\n${link}\n\nIf it wasn’t you, ignore this email.`);
            if (!secure) console.log(`Password reset for ${one.email}: ${link}`);
          }
          return show(p, 'Reset your password', accountPages.forgot({ sent: true }));
        }
        if (path === '/account/reset') {
          const raw = String(form.get('token') ?? '');
          const reset = await customers.reset(raw, form.get('password'));
          if (reset.error) return show(p, 'Choose a new password', accountPages.reset({ token: raw, problem: problem(reset.error), works: customers.peek(raw) }), { status: 422 });
          res.setHeader('set-cookie', reset.cookie);
          return back(res, withDone('/account', 'Your new password is saved.'));
        }
        if (path === '/account/profile') {
          if (!account) return back(res, '/account/sign-in');
          const renamed = await customers.rename(account.customer, form.get('name'));
          return back(res, renamed.ok ? withDone('/account', 'Saved.') : withProblem('/account', renamed));
        }
        return send(res, 404, 'Not found');
      }
      // The admin's changes. Staff cancel and handle; owners change customers, settings and events.
      if (path.startsWith('/admin/')) {
        if (!atDesk) return back(res, '/admin');
        const key = String(form.get('key') ?? '');
        if (on.appointments && path === '/admin/appointments/cancel') {
          const done = await desk.cancel(null, key, { staff: true });
          if (done.ok) await desk.audit(who, `cancelled ${done.appt.name}’s ${done.appt.what}, ${done.appt.when}`, key);
          return back(res, done.ok ? withDone('/admin/appointments', `${done.appt.name}’s appointment is cancelled; we’ve texted them.`) : withProblem('/admin/appointments', done));
        }
        if (path === '/admin/inbox/handled') {
          const done = await desk.handled(key);
          if (done.ok) await desk.audit(who, 'marked a form handled', key);
          return back(res, done.ok ? withDone('/admin/inbox', 'Marked handled.') : withProblem('/admin/inbox', done));
        }
        if (!owner) return back(res, '/admin');
        const customerAction = path.match(/^\/admin\/customers\/(c[a-z0-9]+)\/(disabled|reset)$/);
        const one = customerAction && customers.get(customerAction[1]);
        if (one && customerAction[2] === 'disabled') {
          const off = form.get('disabled') === 'yes';
          const changed = await customers.setDisabled(one.customer, off);
          if (changed?.error) return back(res, withProblem(`/admin/customers/${one.customer}`, changed));
          await desk.audit(who, `${off ? 'turned off' : 'turned back on'} ${one.name}’s account`, one.customer);
          return back(res, withDone(`/admin/customers/${one.customer}`, off ? 'Turned off and signed out everywhere.' : 'Turned back on.'));
        }
        if (one) {
          const raw = await customers.resetToken(one.email);
          if (!raw) return back(res, withProblem(`/admin/customers/${one.customer}`, { error: 'That account is turned off.' }));
          await desk.email(one.email, `Reset your ${site.name} password`, `Hi ${one.name},\n\nThis link sets a new password. It works once, for an hour:\n${origin(req)}/account/reset?token=${raw}`);
          await desk.audit(who, `emailed ${one.name} a reset link`, one.customer);
          return back(res, withDone(`/admin/customers/${one.customer}`, 'Sent. It’s in the outbox.'));
        }
        if (path === '/admin/settings') {
          const saved = await desk.setSite(form);
          if (saved.error) return back(res, withProblem('/admin/settings', saved));
          await desk.audit(who, 'changed the site’s words and prices');
          return back(res, withDone('/admin/settings', 'Saved. The site shows it now.'));
        }
        if (on.events && path === '/admin/events/new') {
          const added = await desk.addEvent(form);
          if (added.error) return back(res, withProblem('/admin/events', added));
          await desk.audit(who, `added ${added.event.title} to the calendar`, added.key);
          return back(res, withDone('/admin/events', `Added: ${added.event.title}.`));
        }
        return send(res, 404, 'Not found');
      }
      if (await pages.handle(req, res, url, form)) return;
      if (path.startsWith('/staff/')) {
        if (!atDesk) return back(res, '/staff');
        const key = String(form.get('key') ?? '');
        if (on.appointments && path === '/staff/cancel') {
          const done = await desk.cancel(null, key, { staff: true });
          if (done.ok) await desk.audit(who, `cancelled ${done.appt.name}’s ${done.appt.what}, ${done.appt.when}`, key);
          return back(res, done.ok ? withDone(`/staff?day=${done.appt.date}`, `${done.appt.name}’s appointment is cancelled; we’ve texted them.`) : withProblem('/staff', done));
        }
        if (path === '/staff/handled') {
          const done = await desk.handled(key);
          return back(res, done.ok ? withDone('/staff', 'Marked handled.') : withProblem('/staff', done));
        }
      }
      return send(res, 404, 'Not found');
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');

    const p = zubra.page();
    const path = url.pathname;
    if (path === '/') return show(p, 'Home', home(p, url, guest, account), { here: '/', landing: true });

    // A customer's pages.
    if (path === '/account') return account ? show(p, 'Your account', accountPages.account({ desk, guest, customer: account, said: note(url) }), { here: '/account' }) : back(res, '/account/sign-in');
    if (path === '/account/sign-in') return account ? back(res, '/account') : show(p, 'Sign in', (demo ? `<div class="auth">${guestSignIn(escape)}</div>` : '') + accountPages.signIn({ problem: note(url) }), { here: '/account/sign-in' });
    if (path === '/account/sign-up') return account ? back(res, '/account') : show(p, 'Make an account', accountPages.signUp());
    if (path === '/account/forgot') return show(p, 'Reset your password', accountPages.forgot());
    if (path === '/account/reset') {
      const raw = url.searchParams.get('token') ?? '';
      return show(p, 'Choose a new password', accountPages.reset({ token: raw, works: customers.peek(raw) }));
    }

    // The admin: staff only; reports, settings and the outbox for owners.
    if (path === '/admin' || path.startsWith('/admin/')) {
      if (!atDesk) return show(p, 'Sign in', `<div class="auth">${(demo ? demoSignIn(escape, staff.demoLogins) : '') + pages.signIn(url)}</div>`);
      const bar = pages.bar(who);
      const said = note(url);
      const wide = { wide: true, here: '/admin' };
      if (path === '/admin') return show(p, 'Overview', admin.dashboard({ who, owner, bar }), wide);
      if (on.appointments && path === '/admin/appointments') return show(p, 'Appointments', said + admin.appointments({ url, owner, bar }), wide);
      if (on.appointments && path === '/admin/appointments.csv') return downloadCsv(res, 'appointments.csv', admin.appointmentsCsv(url));
      if (on.events && path === '/admin/events') return show(p, 'Events', admin.events({ owner, bar, said }), wide);
      const oneEvent = on.events && path.match(/^\/admin\/events\/(e[a-z0-9]+)(\.csv)?$/);
      const event = oneEvent && desk.event(oneEvent[1]);
      if (event) return oneEvent[2] ? downloadCsv(res, 'sign-ups.csv', admin.eventCsv(event)) : show(p, event.title, admin.event({ event, owner, bar }), wide);
      if (on.giving && path === '/admin/gifts') return show(p, 'Giving', admin.gifts({ url, owner, bar }), wide);
      if (on.giving && path === '/admin/gifts.csv') return downloadCsv(res, 'gifts.csv', admin.giftsCsv());
      if (path === '/admin/inbox') return show(p, 'Inbox', admin.inbox({ owner, bar, said }), wide);
      if (path === '/admin/customers') return show(p, 'Customers', admin.customers({ url, owner, bar }), wide);
      if (path === '/admin/customers.csv') return downloadCsv(res, 'customers.csv', admin.customersCsv());
      const oneCustomer = path.match(/^\/admin\/customers\/(c[a-z0-9]+)$/);
      const one = oneCustomer && customers.get(oneCustomer[1]);
      if (one) return show(p, one.name, admin.customer({ one, owner, bar, said }), wide);
      if (['/admin/reports', '/admin/reports.csv', '/admin/settings', '/admin/outbox'].includes(path) && !owner) return show(p, 'Owners only', '<section class="page-head"><h1>Owners only</h1><p class="lede">Reports, settings and the outbox are for owners. Ask one to show you this page.</p></section><p><a class="button light" href="/admin">Back to the overview</a></p>', { status: 403, wide: true });
      if (path === '/admin/reports') return show(p, 'Reports', admin.reports({ url, owner, bar }), wide);
      if (path === '/admin/reports.csv') return downloadCsv(res, 'report.csv', admin.reportCsv(url));
      if (path === '/admin/settings') return show(p, 'Settings', admin.settings({ owner, bar, said }), wide);
      if (path === '/admin/outbox') return show(p, 'Outbox', admin.outbox({ owner, bar }), wide);
      return send(res, 404, 'Not found');
    }
    if (on.appointments) {
      if (path === '/book/details') {
        const holding = desk.pending(guest);
        if (!holding) return back(res, withProblem('/', { error: 'Choose a time first.' }));
        return show(p, 'Your details', detailsPage(p, url, holding));
      }
      const booking = path.match(/^\/book\/([a-z-]+)$/);
      const svc = booking && desk.service(booking[1]);
      if (svc) return show(p, `Book ${svc.name}`, bookPage(p, url, guest, svc));
      const showing = path.match(/^\/a\/(a[a-z0-9]+)$/);
      const appt = showing && desk.appointment(guest, showing[1]);
      if (appt) return show(p, 'Your appointment', appointmentPage(url, appt));
    }
    if (on.events) {
      if (path === '/events') return show(p, 'Calendar', calendarPage(p, url));
      const showing = path.match(/^\/events\/(e[a-z0-9]+)$/);
      const event = showing && desk.event(showing[1]);
      if (event) return show(p, event.title, eventPage(p, url, guest, event));
      const mine = path.match(/^\/r\/(r[a-z0-9]+)$/);
      const rsvp = mine && desk.rsvp(guest, mine[1]);
      if (rsvp) return show(p, 'Your sign-up', rsvpPage(p, url, rsvp));
    }
    if (on.giving && path === '/give') return show(p, 'Give', givePage(p, url));
    const showing = path.match(/^\/forms\/([a-z-]+)$/);
    const form = showing && desk.form(showing[1]);
    if (form) return show(p, form.title, formPage(url, form));
    if (await pages.handle(req, res, url, null)) return;
    if (path === '/staff') {
      pages.noStore(res);
      if (!atDesk) return show(p, 'Sign in', `<div class="auth">${(demo ? demoSignIn(escape, staff.demoLogins) : '') + pages.signIn(url)}</div>`);
      return show(p, 'Staff', pages.bar(who) + staffPage(p, url), { wide: true });
    }
    send(res, 404, 'Not found');
  };
  }

  const businesses = new Map();
  const handlerFor = (space) => {
    if (!businesses.has(space.tenant.id)) businesses.set(space.tenant.id, business(space));
    return businesses.get(space.tenant.id);
  };

  // Holds that have run out are let go every 30 seconds, so every page sees the time free.
  const sweeper = setInterval(async () => {
    for (const id of tenancy.opened()) {
      try {
        await (await tenancy.spaceOf(id)).desk.sweep();
      } catch (error) {
        console.error(error);
      }
    }
  }, 30_000);
  sweeper.unref?.();

  const server = createServer(async (req, res) => {
    try {
      // A page's live data, from its own business's log.
      if (await tenancy.handle(req, res)) return;
      if (zubra.handle(req, res)) return;
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/health') return res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
      if (serveAsset(req, res, url)) return;
      // Made-up businesses ask not to be listed.
      if (url.pathname === '/robots.txt') return res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end('User-agent: *\nDisallow: /\n');
      if (url.pathname === '/favicon.ico') return res.writeHead(302, { location: '/assets/favicon.svg' }).end();
      const space = await tenancy.space(req);
      if (!space) return res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('No business here.');
      const guest = guests.ensure(req, res);
      return await handlerFor(space)(req, res, url, guest);
    } catch (error) {
      console.error(error);
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }).end('Something went wrong.');
      else res.end();
    }
  });
  server.on('close', () => clearInterval(sweeper));

  /** Open every business now, and the first owner's setup link for each that has nobody yet. */
  async function open() {
    const links = [];
    for (const tenant of directory.all()) {
      const space = await tenancy.spaceOf(tenant.id);
      if (space.staff.needsOwner()) links.push({ tenant, token: await space.staff.setup() });
    }
    return links;
  }
  return Object.assign(server, { tenancy, open, demo, business: (id) => tenancy.spaceOf(id) });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 3000);
  const server = await createApp();
  const links = await server.open();
  if (server.demo) nightly();
  server.listen(port, '0.0.0.0', () => {
    if (server.demo) console.log('Demo: the seeded businesses, with their sign-ins on the sign-in pages; the data resets every night.');
    for (const tenant of tenantsFromEnv() ?? DEFAULT_TENANTS) console.log(`${sites[tenant.site].name}: http://${tenant.hosts[0]}:${port}`);
    for (const { tenant, token } of links) console.log(`Set up the first owner of ${sites[tenant.site].name} (works once, for a day): http://${tenant.hosts[0]}:${port}/staff/accept?token=${token}`);
  });
}
