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
import { createTenants } from '@potomac-solutions/kit/tenant';
import { createTenancy } from '@potomac-solutions/kit/tenancy';
import { createDesk, deskSync, CONTACT, timeLabel, dateLabel } from './src/desk.js';
import { sites } from './src/site.js';
import { layout, escape } from './src/layout.js';

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
  { id: 'bittinger-vfc', site: 'community', hosts: ['127.0.0.1', 'firehall.localhost'] },
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
    setup: async ({ tenant, sync, store }) => ({
      desk: await createDesk({ sync, store, site: tenant.site, now, holdMs }),
      staff: createStaff({ store, secure, now, ...(staffCost ? { cost: staffCost } : {}) }),
    }),
  });
  const guests = signedCookie({ secret, name: 'guest', secure });
  const zubra = createZubra({ components, cache });

  /** One business's pages and routes. */
  function business({ desk, staff }) {
  const { on } = desk;
  const site = desk.site;
  const clockAt = (at) => new Date(at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: site.timeZone }).toLowerCase();

  const send = (res, status, html) => (res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' }), res.end(html));
  const back = (res, location) => (res.writeHead(303, { location }), res.end());
  const page = (res, p, title, body) => send(res, 200, p.finish(layout({ title, site, body })));
  const note = (url) => {
    const problem = (url.searchParams.get('problem') ?? '').slice(0, 200);
    const done = (url.searchParams.get('done') ?? '').slice(0, 200);
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
  function home(p, url, guest) {
    const mine = desk.appointmentsFor(guest);
    const signed = on.events ? desk.rsvpsFor(guest) : [];
    const fund = desk.fund();
    return `<section><h1>${escape(site.name)}</h1><p class="lede">${escape(site.about)}</p></section>
${note(url)}
${site.notice ? `<p class="bulletin">${escape(site.notice)}</p>` : ''}
${mine.length ? `<section class="panel"><h2>Your appointments</h2><ul>${mine.map((appt) => `<li><a href="/a/${appt.key}">${escape(appt.when)}</a> · ${escape(appt.what)}</li>`).join('')}</ul></section>` : ''}
${signed.length ? `<section class="panel"><h2>You’re signed up</h2><ul>${signed.map((one) => `<li><a href="/r/${one.key}">${escape(one.title)}</a> · ${one.count} ${one.count === 1 ? 'place' : 'places'}</li>`).join('')}</ul></section>` : ''}
${on.appointments ? `<section><h2>Book an appointment</h2></section><ul class="cards">${site.services.map((svc) => `<li class="card"><h3>${escape(svc.name)}</h3><p class="meta">${svc.minutes} minutes · ${escape(svc.price)}</p><p>${escape(svc.about)}</p><a class="go" href="/book/${svc.id}">Book</a></li>`).join('')}</ul>` : ''}
${on.events ? `<section><h2>Coming up</h2></section><ul class="cards">${desk.events().slice(0, 3).map((event) => eventCard(p, event)).join('')}</ul><p><a href="/events">The whole calendar</a></p>` : ''}
${fund ? `<section class="panel"><h2>${escape(fund.title)}</h2><p>${escape(site.fund.about)}</p>${fundBar(p, fund)}<a class="go" href="/give">Give</a></section>` : ''}
<section><h2>Get in touch</h2></section>
<ul class="cards">${site.forms.map((form) => `<li class="card"><h3>${escape(form.title)}</h3><p>${escape(form.intro)}</p><a class="go" href="/forms/${form.id}">Open the form</a></li>`).join('')}</ul>`;
  }

  function bookPage(p, url, guest, svc) {
    const staffChoice = desk.person(url.searchParams.get('staff')) && svc.id && desk.staffFor(svc.id).some((one) => one.id === url.searchParams.get('staff')) ? url.searchParams.get('staff') : 'any';
    const days = desk.days(svc.id, staffChoice);
    const asked = url.searchParams.get('date');
    const day = days.find((one) => one.date === asked) ?? days.find((one) => one.free) ?? days[0];
    const link = (staffId, date) => `/book/${svc.id}?staff=${staffId}${date ? `&date=${date}` : ''}`;
    const holding = desk.pending(guest);
    const choices = [{ id: 'any', name: 'Anyone' }, ...desk.staffFor(svc.id)];
    return `<section><h1>${escape(svc.name)}</h1><p class="lede">${svc.minutes} minutes · ${escape(svc.price)} · ${escape(svc.about)}</p></section>
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
    return `<section><h1>Your details</h1><p class="lede">${escape(svc.name)} with ${escape(desk.person(holding.staff).name)}, ${escape(dateLabel(holding.date))} at ${escape(timeLabel(holding.time))}.</p></section>
${note(url)}
<p class="bulletin">${holding.until ? `Held for you until ${escape(clockAt(holding.until))}.` : 'Your hold ran out, but you can still book it if nobody has taken it.'}</p>
<form class="panel" method="post" action="/book/details">${fields([...CONTACT, ...svc.intake])}<button type="submit">Book it</button></form>
<form method="post" action="/book/letgo"><button class="button light" type="submit">Let this time go</button></form>`;
  }

  function appointmentPage(url, appt) {
    const cancelled = appt.status === 'cancelled';
    return `<section><h1>${cancelled ? 'Cancelled' : 'You’re booked'}</h1><p class="lede">${escape(appt.what[0].toUpperCase() + appt.what.slice(1))}, ${escape(appt.when)}.</p></section>
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
    return `<section><h1>Calendar</h1><p class="lede">What’s on at ${escape(site.name)}.</p></section>
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
    return `<section><h1>${cancelled ? 'Cancelled' : 'You’re signed up'}</h1><p class="lede">${escape(rsvp.event.title)}, ${escape(eventWhen(rsvp.event))}. ${rsvp.count} ${rsvp.count === 1 ? 'place' : 'places'}, for ${escape(rsvp.name)}.</p></section>
${note(url)}
${placesLeft(p, rsvp.event)}
${cancelled ? `<p><a class="go" href="/events/${rsvp.event.key}">Sign up again</a></p>` : `<form method="post" action="/r/${rsvp.key}/cancel"><button class="button light" type="submit">Cancel, and give the places back</button></form>`}`;
  }

  function givePage(p, url) {
    const fund = desk.fund();
    return `<section><h1>Give to ${escape(fund.title.replace(/^The /, 'the '))}</h1><p class="lede">${escape(site.fund.about)}</p></section>
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
    return `<section><h1>${escape(form.title)}</h1><p class="lede">${escape(form.intro)}</p></section>
${note(url)}
<form class="panel" method="post" action="/forms/${form.id}">${fields(form.fields)}<button type="submit">Send</button></form>`;
  }

  // ---- The staff's page --------------------------------------------------------------------------------
  function staffPage(p, url) {
    const parts = [`<section><h1>${on.appointments ? 'The front desk' : 'The office'}</h1><p class="lede">Everything people have booked, signed up for, given and sent.</p></section>`, note(url)];
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

  // ---- Staff accounts: signing in, links, people ------------------------------------------------
  const noStore = (res) => {
    res.setHeader('cache-control', 'no-store');
    // A link token in the address must not leave in a Referer header.
    res.setHeader('referrer-policy', 'no-referrer');
  };
  function signInPage(url) {
    const nobody = staff.needsOwner();
    return `<section><h1>${on.appointments ? 'The front desk' : 'The office'}</h1><p class="lede">For ${escape(site.name)}’s staff.</p></section>
${note(url)}
${nobody ? '<p class="bulletin">Nobody has an account here yet. The first owner’s setup link is in the server’s log.</p>' : ''}
<form class="panel" method="post" action="/staff/sign-in">
  <label for="f-email">Email<input id="f-email" type="email" name="email" autocomplete="username" required></label>
  <label for="f-password">Password<input id="f-password" type="password" name="password" autocomplete="current-password" required></label>
  <button type="submit">Sign in</button>
</form>
<p class="hint">Forgot your password? Ask an owner for a reset link.</p>`;
  }
  function acceptPage(raw, problem = '') {
    const link = staff.peek(raw);
    if (!link) return `<section><h1>That link has expired</h1><p class="lede">Links work once, for a week. Ask an owner for a new one.</p></section>`;
    const heading = link.kind === 'reset' ? 'Choose a new password' : link.setup ? `Set up ${escape(site.name)}` : `Join ${escape(site.name)}`;
    const lede = link.kind === 'reset' ? `For ${escape(link.email)}.` : link.setup ? 'You’ll be the owner: you can invite the rest of the staff.' : `For ${escape(link.email)}.`;
    return `<section><h1>${heading}</h1><p class="lede">${lede}</p></section>
${problem ? `<p class="notice" role="alert">${escape(problem)}</p>` : ''}
<form class="panel" method="post" action="/staff/accept">
  <input type="hidden" name="token" value="${escape(raw)}">
  ${link.setup ? '<label for="f-email">Your email<input id="f-email" type="email" name="email" autocomplete="username" required></label>' : ''}
  ${link.kind === 'invite' ? `<label for="f-name">Your name<input id="f-name" name="name" value="${escape(link.name)}" autocomplete="name" maxlength="80" required></label>` : ''}
  <label for="f-password">${link.kind === 'reset' ? 'New password' : 'Choose a password'}<span class="hint">At least 10 characters.</span><input id="f-password" type="password" name="password" autocomplete="new-password" minlength="10" required></label>
  <button type="submit">${link.kind === 'reset' ? 'Set it and sign in' : 'Make my account'}</button>
</form>`;
  }
  const linkTo = (req, raw) => `${secure ? 'https' : 'http'}://${req.headers.host}/staff/accept?token=${raw}`;
  function peoplePage(url, who, shown = null) {
    const people = staff.list();
    return `<section><h1>People</h1><p class="lede">Who can sign in to ${escape(site.name)}’s staff pages.</p></section>
${note(url)}
${shown ? `<section class="panel" role="status"><h2>${escape(shown.title)}</h2><p>Send this link to ${escape(shown.to)}. It works once, within a week.</p><p><input readonly value="${escape(shown.link)}" aria-label="The link" style="width:100%"></p></section>` : ''}
<section class="panel"><h2>Everyone</h2><table><tbody>${people
      .map(
        (one) => `<tr${one.disabled ? ' class="done"' : ''}><td><strong>${escape(one.name)}</strong>${one.account === who.account ? ' (you)' : ''}<br><small>${escape(one.email)}</small></td><td>${one.disabled ? 'Turned off' : one.roles.includes('owner') ? 'Owner' : 'Staff'}</td><td class="row">
<form method="post" action="/staff/people/role"><input type="hidden" name="account" value="${one.account}"><input type="hidden" name="role" value="${one.roles.includes('owner') ? 'staff' : 'owner'}"><button class="button light" type="submit">${one.roles.includes('owner') ? 'Make staff' : 'Make owner'}</button></form>
<form method="post" action="/staff/people/${one.disabled ? 'on' : 'off'}"><input type="hidden" name="account" value="${one.account}"><button class="button light" type="submit">${one.disabled ? 'Turn on' : 'Turn off'}</button></form>
${one.disabled ? '' : `<form method="post" action="/staff/people/reset"><input type="hidden" name="account" value="${one.account}"><button class="button light" type="submit">Reset link</button></form>`}</td></tr>`,
      )
      .join('')}</tbody></table></section>
<form class="panel" method="post" action="/staff/people/invite"><h2>Invite someone</h2>
  <label for="f-email">Their email<input id="f-email" type="email" name="email" required></label>
  <label for="f-name">Their name<input id="f-name" name="name" maxlength="80"></label>
  <label for="f-role">What they can do<select id="f-role" name="role"><option value="staff">Staff: the day sheet, sign-ups, giving and the inbox</option><option value="owner">Owner: all that, and people</option></select></label>
  <button type="submit">Make an invite link</button>
</form>`;
  }
  const passwordPage = (url) => `<section><h1>Your password</h1></section>
${note(url)}
<form class="panel" method="post" action="/staff/password">
  <label for="f-current">Current password<input id="f-current" type="password" name="current" autocomplete="current-password" required></label>
  <label for="f-next">New password<span class="hint">At least 10 characters. Your other devices are signed out.</span><input id="f-next" type="password" name="next" autocomplete="new-password" minlength="10" required></label>
  <button type="submit">Change it</button>
</form>`;
  const signedInBar = (who) => `<p class="hint">Signed in as ${escape(who.name)}${staff.can(who, 'owner') ? ' · <a href="/staff/people">People</a>' : ''} · <a href="/staff/password">Your password</a> · <form class="inline" method="post" action="/staff/sign-out"><button class="button light" type="submit">Sign out</button></form></p>`;

  /** Answer one request for this business. */
  return async function handle(req, res, url, guest) {
    const who = staff.session(req);
    const atDesk = staff.can(who, 'staff');
    const isOwner = staff.can(who, 'owner');
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
      if (path === '/staff/sign-in') {
        const done = await staff.signIn(form.get('email'), form.get('password'));
        if (done.error) return back(res, withProblem('/staff', { error: done.error === 'locked' ? 'Too many tries. Wait 15 minutes, or ask an owner for a reset link.' : 'That email and password don’t match.' }));
        res.setHeader('set-cookie', done.cookie);
        return back(res, '/staff');
      }
      if (path === '/staff/accept') {
        noStore(res);
        const raw = String(form.get('token') ?? '');
        const done = await staff.accept(raw, { email: form.get('email'), name: form.get('name'), password: form.get('password') });
        if (done.error) return page(res, zubra.page(), 'Your account', acceptPage(raw, done.error));
        res.setHeader('set-cookie', done.cookie);
        return back(res, withDone('/staff', 'You’re signed in.'));
      }
      if (path === '/staff/sign-out') {
        const done = await staff.signOut(req);
        res.setHeader('set-cookie', done.cookie);
        return back(res, withDone('/staff', 'Signed out.'));
      }
      if (path.startsWith('/staff/')) {
        if (!atDesk) return back(res, '/staff');
        const key = String(form.get('key') ?? '');
        if (path === '/staff/password') {
          const done = await staff.changePassword(who, form.get('current'), form.get('next'));
          return back(res, done.ok ? withDone('/staff', 'Password changed. Your other devices are signed out.') : withProblem('/staff/password', done));
        }
        if (path.startsWith('/staff/people/')) {
          if (!isOwner) return back(res, '/staff');
          noStore(res);
          const account = String(form.get('account') ?? '');
          const role = form.get('role') === 'owner' ? ['owner'] : ['staff'];
          if (path === '/staff/people/invite') {
            const email = String(form.get('email') ?? '');
            const done = await staff.invite(who, { email, name: form.get('name') ?? '', roles: role });
            if (done.error) return back(res, withProblem('/staff/people', done));
            return page(res, zubra.page(), 'People', peoplePage(url, who, { title: 'Invite link', to: email.trim(), link: linkTo(req, done.token) }));
          }
          if (path === '/staff/people/reset') {
            const done = await staff.resetLink(who, account);
            if (done.error) return back(res, withProblem('/staff/people', done));
            const person = staff.list().find((one) => one.account === account);
            return page(res, zubra.page(), 'People', peoplePage(url, who, { title: 'Reset link', to: person.name, link: linkTo(req, done.token) }));
          }
          const done = path === '/staff/people/role' ? await staff.setRoles(who, account, role) : path === '/staff/people/off' ? await staff.setDisabled(who, account, true) : path === '/staff/people/on' ? await staff.setDisabled(who, account, false) : null;
          if (!done) return send(res, 404, 'Not found');
          return back(res, done.ok ? withDone('/staff/people', 'Done.') : withProblem('/staff/people', done));
        }
        if (on.appointments && path === '/staff/cancel') {
          const done = await desk.cancel(null, key, { staff: true });
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
    if (path === '/') return page(res, p, 'Home', home(p, url, guest));
    if (on.appointments) {
      if (path === '/book/details') {
        const holding = desk.pending(guest);
        if (!holding) return back(res, withProblem('/', { error: 'Choose a time first.' }));
        return page(res, p, 'Your details', detailsPage(p, url, holding));
      }
      const booking = path.match(/^\/book\/([a-z-]+)$/);
      const svc = booking && desk.service(booking[1]);
      if (svc) return page(res, p, `Book ${svc.name}`, bookPage(p, url, guest, svc));
      const showing = path.match(/^\/a\/(a[a-z0-9]+)$/);
      const appt = showing && desk.appointment(guest, showing[1]);
      if (appt) return page(res, p, 'Your appointment', appointmentPage(url, appt));
    }
    if (on.events) {
      if (path === '/events') return page(res, p, 'Calendar', calendarPage(p, url));
      const showing = path.match(/^\/events\/(e[a-z0-9]+)$/);
      const event = showing && desk.event(showing[1]);
      if (event) return page(res, p, event.title, eventPage(p, url, guest, event));
      const mine = path.match(/^\/r\/(r[a-z0-9]+)$/);
      const rsvp = mine && desk.rsvp(guest, mine[1]);
      if (rsvp) return page(res, p, 'Your sign-up', rsvpPage(p, url, rsvp));
    }
    if (on.giving && path === '/give') return page(res, p, 'Give', givePage(p, url));
    const showing = path.match(/^\/forms\/([a-z-]+)$/);
    const form = showing && desk.form(showing[1]);
    if (form) return page(res, p, form.title, formPage(url, form));
    if (path === '/staff') {
      noStore(res);
      if (!atDesk) return page(res, p, 'Sign in', signInPage(url));
      return page(res, p, 'Staff', signedInBar(who) + staffPage(p, url));
    }
    if (path === '/staff/accept') {
      noStore(res);
      return page(res, p, 'Your account', acceptPage(url.searchParams.get('token') ?? ''));
    }
    if (path === '/staff/password') {
      if (!atDesk) return back(res, '/staff');
      noStore(res);
      return page(res, p, 'Your password', passwordPage(url));
    }
    if (path === '/staff/people') {
      if (!isOwner) return back(res, '/staff');
      noStore(res);
      return page(res, p, 'People', peoplePage(url, who));
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
      if (url.pathname === '/favicon.ico') return res.writeHead(204).end();
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
  return Object.assign(server, { tenancy, open, business: (id) => tenancy.spaceOf(id) });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 3000);
  const server = await createApp();
  const links = await server.open();
  server.listen(port, '0.0.0.0', () => {
    for (const tenant of tenantsFromEnv() ?? DEFAULT_TENANTS) console.log(`${sites[tenant.site].name}: http://${tenant.hosts[0]}:${port}`);
    for (const { tenant, token } of links) console.log(`Set up the first owner of ${sites[tenant.site].name} (works once, for a day): http://${tenant.hosts[0]}:${port}/staff/accept?token=${token}`);
  });
}
