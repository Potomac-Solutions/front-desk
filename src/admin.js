// The admin pages: the business at a glance, appointments, events, giving, the inbox, customers,
// reports and settings. Which ones a business has follows the modules its site switches on.
//
// Staff see the overview, the lists and the inbox. Owners also see reports, settings and the
// outbox, and can turn a customer's account off. Every page is plain HTML and forms.
import { series, totals, breakdown, csv } from '@potomac-solutions/kit/reports';
import { escape } from './layout.js';
import { dateLabel, timeLabel } from './desk.js';
import { money } from './account.js';
import { barChart, rankBars } from '@potomac-solutions/kit/charts';

const DAY = 86_400_000;
const PAGE = 25;
const badge = (status, words) => `<span class="badge ${status}">${escape(words)}</span>`;

export const RANGES = {
  '30d': { label: 'Last 30 days', days: 30, by: 'day' },
  '13w': { label: 'Last 13 weeks', days: 91, by: 'week' },
  '12m': { label: 'Last 12 months', days: 365, by: 'month' },
};

export function createAdmin({ desk, customers, now = Date.now }) {
  const { site, on } = desk;
  const zone = site.timeZone;
  const dateTime = (ms) => (ms ? new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: zone }) : '');
  const short = (start, by) => {
    const date = new Date(`${start}T12:00:00Z`);
    return by === 'month' ? date.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' }) : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  };
  const localDate = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: zone });
  const percent = (share) => `${Math.round(share * 100)}%`;
  const option = (value, words, current) => `<option value="${escape(value)}"${current === value ? ' selected' : ''}>${escape(words)}</option>`;

  function nav(here, owner) {
    const link = (href, words) => `<a href="${href}"${here === href ? ' aria-current="page"' : ''}>${words}</a>`;
    return `<nav class="admin-nav" aria-label="Admin"><small>${on.appointments ? 'Desk' : 'Office'}</small>${link('/admin', 'Overview')}${on.appointments ? link('/admin/appointments', 'Appointments') : ''}${on.events ? link('/admin/events', 'Events') : ''}${on.giving ? link('/admin/gifts', 'Giving') : ''}${link('/admin/inbox', 'Inbox')}${link('/admin/customers', 'Customers')}${link('/staff', on.appointments ? 'The day sheet' : 'The office page')}${
      owner ? `<small>Owner</small>${link('/admin/reports', 'Reports')}${link('/admin/settings', 'Settings')}${link('/staff/people', 'Staff')}${link('/admin/outbox', 'Outbox')}` : ''
    }</nav>`;
  }
  const frame = (here, owner, bar, body) => `<div class="admin">${nav(here, owner)}<div class="admin-body">${bar}${body}</div></div>`;

  // ---- Appointments -----------------------------------------------------------------------------
  /** Chair minutes booked over chair minutes open, for these dates. */
  function chairUse(appts, dates) {
    const open = dates.reduce((sum, date) => {
      const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
      return sum + site.staff.filter((one) => one.days.includes(weekday)).reduce((n, one) => n + (Number(one.closes.slice(0, 2)) * 60 + Number(one.closes.slice(3)) - Number(one.opens.slice(0, 2)) * 60 - Number(one.opens.slice(3))), 0);
    }, 0);
    const set = new Set(dates);
    const used = appts.filter((appt) => appt.status === 'booked' && set.has(appt.date)).reduce((sum, appt) => sum + appt.minutes, 0);
    return open ? used / open : 0;
  }
  const nextDays = (n) => Array.from({ length: n }, (_, i) => localDate(now() + i * DAY));
  const lastDays = (n) => Array.from({ length: n }, (_, i) => localDate(now() - (n - i) * DAY));

  function filterAppointments(url) {
    const q = (url.searchParams.get('q') ?? '').trim().toLowerCase().slice(0, 80);
    const status = url.searchParams.get('status') ?? '';
    const who = url.searchParams.get('staff') ?? '';
    const what = url.searchParams.get('service') ?? '';
    const when = url.searchParams.get('when') ?? 'upcoming';
    const today = desk.today();
    const list = desk
      .allAppointments()
      .filter(
        (appt) =>
          (!status || appt.status === status) &&
          (!who || appt.staff === who) &&
          (!what || appt.service === what) &&
          (when === 'all' || (when === 'upcoming' ? appt.date >= today : appt.date < today)) &&
          (!q || [appt.key, appt.name, appt.phone, appt.email].some((field) => String(field ?? '').toLowerCase().includes(q))),
      );
    return list.sort((a, b) => (when === 'upcoming' ? 1 : -1) * (a.date + a.time < b.date + b.time ? -1 : 1));
  }
  const apptRows = (list, { cancel = false } = {}) =>
    list.length
      ? `<div class="table-wrap"><table><thead><tr><th scope="col">When</th><th scope="col">Who</th><th scope="col">What</th><th scope="col">Status</th>${cancel ? '<th scope="col"></th>' : ''}</tr></thead><tbody>${list
          .map(
            (appt) =>
              `<tr><td>${escape(dateLabel(appt.date))}, ${escape(timeLabel(appt.time))}<br><small class="muted">${escape(appt.key)}</small></td><td>${escape(appt.name)}${appt.customer ? ` <a class="muted" href="/admin/customers/${escape(appt.customer)}">(account)</a>` : ''}<br><small class="muted">${escape(appt.phone)}${appt.email ? ` · ${escape(appt.email)}` : ''}</small></td><td>${escape(appt.what)}${appt.answers?.length ? `<br><small class="muted">${appt.answers.map(([label, value]) => `${escape(label)} ${escape(value)}`).join(' · ')}</small>` : ''}</td><td>${appt.status === 'cancelled' ? badge('cancelled', `Cancelled${appt.cancelledBy ? ` by ${appt.cancelledBy}` : ''}`) : appt.date < desk.today() ? badge('past', 'Done') : badge('booked', 'Booked')}</td>${
                cancel ? `<td>${appt.status === 'booked' && appt.date >= desk.today() ? `<form method="post" action="/admin/appointments/cancel"><input type="hidden" name="key" value="${appt.key}"><button class="button light" type="submit">Cancel</button></form>` : ''}</td>` : ''
              }</tr>`,
          )
          .join('')}</tbody></table></div>`
      : '<p>None.</p>';

  // ---- Shared ------------------------------------------------------------------------------------
  const giftsIn = (from, to) => desk.gifts().filter((gift) => gift.at >= from && gift.at <= to);
  const range = (url) => {
    const key = RANGES[url.searchParams.get('range')] ? url.searchParams.get('range') : '30d';
    const { days, by, label } = RANGES[key];
    const to = now();
    return { key, by, label, to, from: to - (days - 1) * DAY };
  };
  const pager = (url, base, count, page) => {
    const pages = Math.max(1, Math.ceil(count / PAGE));
    const at = (n) => {
      const next = new URLSearchParams(url.searchParams);
      next.set('page', String(n));
      return `${base}?${next}`;
    };
    return pages > 1 ? `<p class="pager">${page > 1 ? `<a href="${escape(at(page - 1))}">Previous</a>` : ''}<span>Page ${page} of ${pages}</span>${page < pages ? `<a href="${escape(at(page + 1))}">Next</a>` : ''}</p>` : '';
  };
  const pageOf = (url) => Math.max(1, Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1);

  return {
    nav,

    dashboard({ who, owner, bar }) {
      const at = now();
      const tiles = [];
      const panels = [];
      if (on.appointments) {
        const appts = desk.allAppointments();
        const today = desk.today();
        const done30 = appts.filter((appt) => appt.status === 'booked' && appt.date < today && appt.date >= localDate(at - 30 * DAY));
        const made30 = appts.filter((appt) => appt.at > at - 30 * DAY);
        const cancelled30 = made30.filter((appt) => appt.status === 'cancelled').length;
        tiles.push(
          `<div class="tile"><span>Today</span><strong>${appts.filter((appt) => appt.status === 'booked' && appt.date === today).length}</strong><small>appointments</small></div>`,
          `<div class="tile"><span>Chairs booked, next 7 days</span><strong>${percent(chairUse(appts, nextDays(7)))}</strong><small>${appts.filter((appt) => appt.status === 'booked' && nextDays(7).includes(appt.date)).length} appointments</small></div>`,
          `<div class="tile"><span>Takings, last 30 days</span><strong>${money(totals(done30, { amount: (appt) => appt.cents }).amount)}</strong><small>at typical prices, ${done30.length} appointments</small></div>`,
          `<div class="tile"><span>Cancelled, last 30 days</span><strong>${made30.length ? percent(cancelled30 / made30.length) : '0%'}</strong><small>${cancelled30} of ${made30.length} booked</small></div>`,
        );
        const days = lastDays(30);
        const counts = series(
          appts.filter((appt) => appt.status === 'booked'),
          { at: (appt) => Date.parse(`${appt.date}T12:00:00Z`), by: 'day', zone: 'UTC', from: Date.parse(`${days[0]}T00:00:00Z`), to: Date.parse(`${days.at(-1)}T23:59:59Z`) },
        );
        panels.push(`<section class="panel"><h2>Appointments by day, last 30 days</h2>${barChart(counts.map((b) => ({ label: short(b.start, 'day'), value: b.count, tip: `${dateLabel(b.start)}: ${b.count} appointment${b.count === 1 ? '' : 's'}` })), { name: 'Appointments' })}</section>`);
        panels.push(`<section class="panel"><h2>Next up</h2>${apptRows(filterAppointments(new URL('http://x/?when=upcoming&status=booked')).slice(0, 8))}<p><a href="/admin/appointments">Every appointment</a></p></section>`);
      }
      if (on.events) {
        const coming = desk.events();
        const withPlaces = coming.filter((event) => event.capacity);
        const capacity = withPlaces.reduce((n, event) => n + event.capacity, 0);
        const taken = withPlaces.reduce((n, event) => n + event.capacity - event.left, 0);
        tiles.push(`<div class="tile"><span>Events ahead</span><strong>${coming.length}</strong><small>${withPlaces.length} with sign-ups</small></div>`, `<div class="tile"><span>Places taken</span><strong>${capacity ? percent(taken / capacity) : '—'}</strong><small>${taken} of ${capacity}</small></div>`);
        panels.push(`<section class="panel"><h2>Coming up</h2>${coming.length ? `<div class="table-wrap"><table><tbody>${coming.slice(0, 6).map((event) => `<tr><td><a href="/admin/events/${event.key}">${escape(event.title)}</a></td><td>${escape(dateLabel(event.date))}, ${escape(timeLabel(event.starts))}</td><td class="num">${event.capacity ? `${event.capacity - event.left} of ${event.capacity}` : 'Open'}</td></tr>`).join('')}</tbody></table></div>` : '<p>Nothing on the calendar.</p>'}<p><a href="/admin/events">Every event</a></p></section>`);
      }
      if (on.giving) {
        const fund = desk.fund();
        const recent = giftsIn(at - 30 * DAY, at);
        const earlier = giftsIn(at - 60 * DAY, at - 30 * DAY);
        const raised = totals(recent, { amount: (gift) => gift.cents }).amount;
        const before = totals(earlier, { amount: (gift) => gift.cents }).amount;
        tiles.push(
          `<div class="tile"><span>Given online, last 30 days</span><strong>${money(raised)}</strong><small>${before ? `${raised >= before ? '▲' : '▼'} ${Math.abs(Math.round(((raised - before) / before) * 100))}% on the 30 days before` : `${recent.length} gifts`}</small></div>`,
          `<div class="tile"><span>${escape(fund.title)}</span><strong>${percent(fund.raised / fund.goal)}</strong><small>${money(fund.raised)} of ${money(fund.goal)}</small></div>`,
        );
        const days = series(desk.gifts(), { at: (gift) => gift.at, amount: (gift) => gift.cents, by: 'day', zone, from: at - 29 * DAY, to: at });
        panels.push(`<section class="panel"><h2>Giving by day, last 30 days</h2>${barChart(days.map((b) => ({ label: short(b.start, 'day'), value: b.amount, tip: `${dateLabel(b.start)}: ${money(b.amount)} from ${b.count} gift${b.count === 1 ? '' : 's'}` })), { name: 'Giving', format: money })}</section>`);
      }
      const unhandled = desk.inbox().filter((one) => !one.handled).length;
      const people = customers.list();
      tiles.push(`<div class="tile"><span>Inbox</span><strong>${unhandled}</strong><small>waiting for a reply</small></div>`, `<div class="tile"><span>Customer accounts</span><strong>${people.length}</strong><small>${people.filter((one) => one.at > at - 30 * DAY).length} new in 30 days</small></div>`);
      const activity = desk.activity(8);
      return frame(
        '/admin',
        owner,
        bar,
        `<section><h1>Overview</h1><p class="lede">${escape(site.name)}, ${escape(dateLabel(desk.today()))}. Good to see you, ${escape(who.name.split(' ')[0])}.</p></section>
<div class="tiles">${tiles.join('')}</div>
${panels.join('\n')}
<section class="panel"><h2>Staff activity</h2>${activity.length ? `<ul>${activity.map((one) => `<li><strong>${escape(one.by)}</strong> ${escape(one.what)} <small class="muted">${dateTime(one.at)}</small></li>`).join('')}</ul>` : '<p>Nothing yet.</p>'}</section>`,
      );
    },

    appointments({ url, owner, bar }) {
      const list = filterAppointments(url);
      const page = pageOf(url);
      const csvQuery = new URLSearchParams(url.searchParams);
      csvQuery.delete('page');
      const when = url.searchParams.get('when') ?? 'upcoming';
      return frame(
        '/admin/appointments',
        owner,
        bar,
        `<section><h1>Appointments</h1><p class="lede">${list.length} ${when === 'past' ? 'past' : when === 'all' ? 'in all' : 'from today on'}.</p></section>
<form class="panel filters" method="get" action="/admin/appointments">
  <label>Search<input name="q" value="${escape(url.searchParams.get('q') ?? '')}" placeholder="Name, phone, email or code"></label>
  <label>When<select name="when">${option('upcoming', 'From today', when)}${option('past', 'Past', when)}${option('all', 'All', when)}</select></label>
  <label>Status<select name="status">${option('', 'Any', url.searchParams.get('status') ?? '')}${option('booked', 'Booked', url.searchParams.get('status'))}${option('cancelled', 'Cancelled', url.searchParams.get('status'))}</select></label>
  <label>With<select name="staff">${option('', 'Anyone', url.searchParams.get('staff') ?? '')}${site.staff.map((one) => option(one.id, one.name, url.searchParams.get('staff'))).join('')}</select></label>
  <label>Service<select name="service">${option('', 'Any', url.searchParams.get('service') ?? '')}${site.services.map((one) => option(one.id, one.name, url.searchParams.get('service'))).join('')}</select></label>
  <button type="submit">Show</button>
  <a class="button light" href="/admin/appointments.csv?${escape(String(csvQuery))}">Download CSV</a>
</form>
<section class="panel">${apptRows(list.slice((page - 1) * PAGE, page * PAGE), { cancel: true })}${pager(url, '/admin/appointments', list.length, page)}</section>`,
      );
    },

    appointmentsCsv(url) {
      return csv(filterAppointments(url), [
        { key: 'key', label: 'Code' },
        { key: 'date', label: 'Date' },
        { key: 'time', label: 'Time' },
        { key: 'service', label: 'Service', value: (appt) => desk.service(appt.service)?.name },
        { key: 'staff', label: 'With', value: (appt) => desk.person(appt.staff)?.name },
        { key: 'status', label: 'Status' },
        { key: 'name', label: 'Name' },
        { key: 'phone', label: 'Phone' },
        { key: 'email', label: 'Email' },
        { key: 'answers', label: 'Answers', value: (appt) => (appt.answers ?? []).map(([label, value]) => `${label} ${value}`).join('; ') },
      ]);
    },

    events({ owner, bar, said }) {
      const all = desk.allEvents();
      const today = desk.today();
      const row = (event) => {
        const signed = event.capacity ? event.capacity - event.left : null;
        return `<tr><td><a href="/admin/events/${event.key}">${escape(event.title)}</a><br><small class="muted">${escape(event.place)}</small></td><td>${escape(dateLabel(event.date))}, ${escape(timeLabel(event.starts))} to ${escape(timeLabel(event.ends))}</td><td class="num">${event.capacity ? `${signed} of ${event.capacity}` : 'No sign-up'}</td><td>${event.date < today ? badge('past', 'Past') : event.capacity && !event.left ? badge('cancelled', 'Full') : badge('booked', 'Open')}</td></tr>`;
      };
      const table = (list) => `<div class="table-wrap"><table><thead><tr><th scope="col">Event</th><th scope="col">When</th><th scope="col" class="num">Places taken</th><th scope="col">Status</th></tr></thead><tbody>${list.map(row).join('')}</tbody></table></div>`;
      const ahead = all.filter((event) => event.date >= today);
      const past = all.filter((event) => event.date < today).reverse();
      return frame(
        '/admin/events',
        owner,
        bar,
        `<section><h1>Events</h1><p class="lede">${ahead.length} ahead, ${past.length} past.</p></section>
${said}
<section class="panel"><h2>Ahead</h2>${ahead.length ? table(ahead) : '<p>Nothing on the calendar.</p>'}</section>
${
  owner
    ? `<form class="panel" method="post" action="/admin/events/new"><h2>Add an event</h2>
<div class="two"><label>Title<input name="title" required maxlength="120"></label><label>Place<input name="place" required maxlength="120" value="The fire hall"></label></div>
<div class="filters"><label>Date<input type="date" name="date" required min="${today}"></label><label>Starts<input type="time" name="starts" required></label><label>Ends<input type="time" name="ends" required></label><label>Places<span class="hint">Empty for no sign-up</span><input name="capacity" inputmode="numeric" maxlength="3"></label></div>
<label>About<textarea name="about" rows="2" maxlength="600"></textarea></label>
<button type="submit">Add it to the calendar</button></form>`
    : ''
}
${past.length ? `<section class="panel"><h2>Past</h2>${table(past)}</section>` : ''}`,
      );
    },

    event({ event, owner, bar }) {
      const list = desk.allRsvps().filter((one) => one.event === event.key).sort((a, b) => a.at - b.at);
      const booked = list.filter((one) => one.status === 'booked');
      return frame(
        '/admin/events',
        owner,
        bar,
        `<section><a href="/admin/events">All events</a><h1>${escape(event.title)}</h1><p class="lede">${escape(dateLabel(event.date))}, ${escape(timeLabel(event.starts))} to ${escape(timeLabel(event.ends))} · ${escape(event.place)}</p></section>
<div class="tiles"><div class="tile"><span>Signed up</span><strong>${booked.reduce((n, one) => n + one.count, 0)}</strong><small>${booked.length} parties</small></div><div class="tile"><span>Places left</span><strong>${event.capacity ? event.left : '—'}</strong><small>${event.capacity ? `of ${event.capacity}` : 'No sign-up needed'}</small></div><div class="tile"><span>Cancelled</span><strong>${list.length - booked.length}</strong></div></div>
<section class="panel"><h2>Sign-ups</h2>${list.length ? `<div class="table-wrap"><table><thead><tr><th scope="col">Name</th><th scope="col">Phone</th><th scope="col">Email</th><th scope="col" class="num">Places</th><th scope="col">Signed up</th><th scope="col">Status</th></tr></thead><tbody>${list.map((one) => `<tr><td>${escape(one.name)}</td><td>${escape(one.phone)}</td><td>${escape(one.email ?? '')}</td><td class="num">${one.count}</td><td>${dateTime(one.at)}</td><td>${one.status === 'cancelled' ? badge('cancelled', 'Cancelled') : badge('booked', 'Coming')}</td></tr>`).join('')}</tbody></table></div><p><a class="button light" href="/admin/events/${event.key}.csv">Download the list (CSV)</a></p>` : '<p>Nobody yet.</p>'}</section>`,
      );
    },

    eventCsv(event) {
      return csv(
        desk.allRsvps().filter((one) => one.event === event.key && one.status === 'booked'),
        [
          { key: 'name', label: 'Name' },
          { key: 'phone', label: 'Phone' },
          { key: 'email', label: 'Email' },
          { key: 'count', label: 'Places' },
          { key: 'at', label: 'Signed up', value: (one) => new Date(one.at).toISOString() },
        ],
      );
    },

    gifts({ url, owner, bar }) {
      const all = desk.gifts();
      const page = pageOf(url);
      const fund = desk.fund();
      const sum = totals(all, { amount: (gift) => gift.cents });
      return frame(
        '/admin/gifts',
        owner,
        bar,
        `<section><h1>Giving</h1><p class="lede">${escape(fund.title)}: ${money(fund.raised)} of ${money(fund.goal)}. Online: ${sum.count} gifts, ${money(sum.amount)}.</p></section>
<section class="panel"><div class="table-wrap"><table><thead><tr><th scope="col">When</th><th scope="col">From</th><th scope="col" class="num">Amount</th><th scope="col">Reference</th></tr></thead><tbody>${all
          .slice((page - 1) * PAGE, page * PAGE)
          .map((gift) => `<tr><td>${dateTime(gift.at)}</td><td>${escape(gift.name)}${gift.customer ? ` <a class="muted" href="/admin/customers/${escape(gift.customer)}">(account)</a>` : ''}<br><small class="muted">${escape(gift.email ?? '')}</small></td><td class="num">${money(gift.cents)}</td><td class="muted">${escape(gift.ref)}</td></tr>`)
          .join('')}</tbody></table></div>${pager(url, '/admin/gifts', all.length, page)}<p><a class="button light" href="/admin/gifts.csv">Download CSV</a></p></section>`,
      );
    },

    giftsCsv() {
      return csv(desk.gifts(), [
        { key: 'at', label: 'When', value: (gift) => new Date(gift.at).toISOString() },
        { key: 'name', label: 'Name' },
        { key: 'email', label: 'Email' },
        { key: 'cents', label: 'Amount (USD)', value: (gift) => gift.cents / 100 },
        { key: 'ref', label: 'Reference' },
      ]);
    },

    inbox({ owner, bar, said }) {
      const list = desk.inbox();
      return frame(
        '/admin/inbox',
        owner,
        bar,
        `<section><h1>Inbox</h1><p class="lede">${list.filter((one) => !one.handled).length} waiting, ${list.filter((one) => one.handled).length} handled.</p></section>
${said}
<section class="panel">${list.length ? list.map((one) => `<article class="stack" style="border-top:1px solid var(--border);padding-top:0.75rem"><p><strong>${escape(one.title)}</strong> ${one.handled ? badge('handled', 'Handled') : badge('booked', 'Waiting')} <small class="muted">${dateTime(one.at)}</small></p><dl>${(one.answers ?? []).map(([label, value]) => `<dt>${escape(label)}</dt><dd>${escape(value)}</dd>`).join('')}</dl>${one.handled ? '' : `<form method="post" action="/admin/inbox/handled"><input type="hidden" name="key" value="${one.key}"><button class="button light" type="submit">Mark handled</button></form>`}</article>`).join('') : '<p>Nothing yet.</p>'}</section>`,
      );
    },

    customers({ url, owner, bar }) {
      const q = (url.searchParams.get('q') ?? '').trim().toLowerCase().slice(0, 80);
      const counts = new Map();
      const add = (customer, field, n = 1) => {
        if (!customer) return;
        const one = counts.get(customer) ?? { appointments: 0, rsvps: 0, cents: 0 };
        one[field] += n;
        counts.set(customer, one);
      };
      for (const appt of desk.allAppointments()) if (appt.status === 'booked') add(appt.customer, 'appointments');
      for (const one of desk.allRsvps()) if (one.status === 'booked') add(one.customer, 'rsvps');
      for (const gift of desk.gifts()) add(gift.customer, 'cents', gift.cents);
      const list = customers.list().filter((one) => !q || one.name.toLowerCase().includes(q) || one.email.includes(q));
      const page = pageOf(url);
      return frame(
        '/admin/customers',
        owner,
        bar,
        `<section><h1>Customers</h1><p class="lede">${customers.list().length} with accounts. People can also book as guests, without one.</p></section>
<form class="panel filters" method="get" action="/admin/customers"><label>Search<input name="q" value="${escape(url.searchParams.get('q') ?? '')}" placeholder="Name or email"></label><button type="submit">Show</button><a class="button light" href="/admin/customers.csv">Download CSV</a></form>
<section class="panel"><div class="table-wrap"><table><thead><tr><th scope="col">Customer</th><th scope="col">Joined</th>${on.appointments ? '<th scope="col" class="num">Appointments</th>' : ''}${on.events ? '<th scope="col" class="num">Sign-ups</th>' : ''}${on.giving ? '<th scope="col" class="num">Given</th>' : ''}</tr></thead><tbody>${list
          .slice((page - 1) * PAGE, page * PAGE)
          .map((one) => {
            const c = counts.get(one.customer) ?? { appointments: 0, rsvps: 0, cents: 0 };
            return `<tr><td><a href="/admin/customers/${escape(one.customer)}">${escape(one.name)}</a>${one.disabled ? ` ${badge('off', 'Off')}` : ''}<br><small class="muted">${escape(one.email)}</small></td><td>${dateTime(one.at)}</td>${on.appointments ? `<td class="num">${c.appointments}</td>` : ''}${on.events ? `<td class="num">${c.rsvps}</td>` : ''}${on.giving ? `<td class="num">${money(c.cents)}</td>` : ''}</tr>`;
          })
          .join('')}</tbody></table></div>${pager(url, '/admin/customers', list.length, page)}</section>`,
      );
    },

    customersCsv() {
      return csv(customers.list(), [
        { key: 'name', label: 'Name' },
        { key: 'email', label: 'Email' },
        { key: 'at', label: 'Joined', value: (one) => new Date(one.at).toISOString() },
        { key: 'disabled', label: 'Turned off', value: (one) => (one.disabled ? 'yes' : 'no') },
      ]);
    },

    customer({ one, owner, bar, said }) {
      const history = desk.history({ pub: null, customer: one.customer });
      const parts = [`<section><a href="/admin/customers">All customers</a><h1>${escape(one.name)}</h1><p class="lede">${escape(one.email)} · joined ${dateTime(one.at)}${one.disabled ? ` · ${badge('off', 'Turned off')}` : ''}</p></section>`, said];
      if (on.appointments) parts.push(`<section class="panel"><h2>Appointments</h2>${apptRows(history.appointments)}</section>`);
      if (on.events) parts.push(`<section class="panel"><h2>Sign-ups</h2>${history.rsvps.length ? `<ul>${history.rsvps.map((r) => `<li>${escape(r.title)}, ${escape(dateLabel(r.event.date))} · ${r.count} · ${r.status === 'cancelled' ? 'cancelled' : 'coming'}</li>`).join('')}</ul>` : '<p>None.</p>'}</section>`);
      if (on.giving) parts.push(`<section class="panel"><h2>Gifts</h2>${history.gifts.length ? `<p>${history.gifts.length} gifts, ${money(totals(history.gifts, { amount: (g) => g.cents }).amount)}.</p>` : '<p>None online.</p>'}</section>`);
      if (owner)
        parts.push(
          `<section class="panel"><h2>Account</h2><p>Turning an account off signs it out everywhere; what it booked stays.</p><div class="filters"><form method="post" action="/admin/customers/${escape(one.customer)}/disabled"><input type="hidden" name="disabled" value="${one.disabled ? 'no' : 'yes'}"><button type="submit" class="${one.disabled ? '' : 'button light'}">${one.disabled ? 'Turn back on' : 'Turn off'}</button></form>${one.disabled ? '' : `<form method="post" action="/admin/customers/${escape(one.customer)}/reset"><button class="button light" type="submit">Email a reset link</button></form>`}</div></section>`,
        );
      return frame('/admin/customers', owner, bar, parts.join('\n'));
    },

    /** The report's numbers, shared by its page and its CSV. */
    report(url) {
      const r = range(url);
      if (on.appointments) {
        const appts = desk.allAppointments().filter((appt) => {
          const at = Date.parse(`${appt.date}T12:00:00Z`);
          return at >= Date.parse(`${localDate(r.from)}T00:00:00Z`) && at <= Date.parse(`${localDate(r.to)}T23:59:59Z`);
        });
        const kept = appts.filter((appt) => appt.status === 'booked');
        const buckets = series(kept, { at: (appt) => Date.parse(`${appt.date}T12:00:00Z`), amount: (appt) => appt.cents, by: r.by, zone: 'UTC', from: Date.parse(`${localDate(r.from)}T00:00:00Z`), to: Date.parse(`${localDate(r.to)}T23:59:59Z`) });
        return { ...r, kind: 'appointments', appts, kept, buckets };
      }
      const gifts = giftsIn(r.from, r.to);
      const buckets = series(gifts, { at: (gift) => gift.at, amount: (gift) => gift.cents, by: r.by, zone, from: r.from, to: r.to });
      return { ...r, kind: 'gifts', gifts, buckets };
    },

    reports({ url, owner, bar }) {
      const r = this.report(url);
      const chips = `<div class="panel filters" role="group" aria-label="Range">${Object.entries(RANGES)
        .map(([key, one]) => `<a class="button${key === r.key ? '' : ' light'}" href="?range=${key}"${key === r.key ? ' aria-current="true"' : ''}>${one.label}</a>`)
        .join('')}</div>`;
      const head = `<section><h1>Reports</h1><p class="lede">${r.label}, by ${r.by}, in the business’s time (${escape(zone)}).</p></section>${chips}`;
      const parts = [head];
      if (r.kind === 'appointments') {
        const cancelled = r.appts.length - r.kept.length;
        const sum = totals(r.kept, { amount: (appt) => appt.cents });
        const dates = [];
        for (let at = r.from; at <= r.to; at += DAY) dates.push(localDate(at));
        parts.push(`<div class="tiles"><div class="tile"><span>Appointments</span><strong>${sum.count}</strong></div><div class="tile"><span>Takings at typical prices</span><strong>${money(sum.amount)}</strong></div><div class="tile"><span>Cancelled</span><strong>${r.appts.length ? percent(cancelled / r.appts.length) : '0%'}</strong><small>${cancelled} of ${r.appts.length}</small></div><div class="tile"><span>Chairs booked</span><strong>${percent(chairUse(r.appts, dates))}</strong><small>of open hours</small></div></div>`);
        parts.push(`<section class="panel"><h2>Appointments by ${r.by}</h2>${barChart(r.buckets.map((b) => ({ label: short(b.start, r.by), value: b.count })), { name: 'Appointments' })}<p><a class="button light" href="/admin/reports.csv?range=${r.key}">Download CSV</a></p></section>`);
        parts.push(`<section class="panel"><h2>Takings by ${r.by}</h2>${barChart(r.buckets.map((b) => ({ label: short(b.start, r.by), value: b.amount })), { name: 'Takings', format: money })}</section>`);
        const byService = breakdown(r.kept, { key: (appt) => desk.service(appt.service)?.name ?? appt.service, amount: (appt) => appt.cents });
        const byStaff = breakdown(r.kept, { key: (appt) => desk.person(appt.staff)?.name ?? appt.staff });
        const byHour = Array.from({ length: 10 }, (_, i) => i + 9).map((hour) => ({ label: timeLabel(`${String(hour).padStart(2, '0')}:00`), value: r.kept.filter((appt) => Number(appt.time.slice(0, 2)) === hour).length }));
        parts.push(`<section class="two"><div class="panel"><h2>By service</h2>${byService.length ? rankBars(byService.map((row) => ({ label: row.key, value: row.count }))) : '<p>None.</p>'}</div><div class="panel"><h2>By chair</h2>${byStaff.length ? rankBars(byStaff.map((row) => ({ label: row.key, value: row.count }))) : '<p>None.</p>'}</div></section>`);
        parts.push(`<section class="panel"><h2>Busiest start times</h2>${rankBars(byHour)}</section>`);
      } else {
        const sum = totals(r.gifts, { amount: (gift) => gift.cents });
        const givers = new Set(r.gifts.map((gift) => (gift.email || gift.name).toLowerCase())).size;
        parts.push(`<div class="tiles"><div class="tile"><span>Given online</span><strong>${money(sum.amount)}</strong></div><div class="tile"><span>Gifts</span><strong>${sum.count}</strong></div><div class="tile"><span>Average gift</span><strong>${money(sum.count ? Math.round(sum.amount / sum.count) : 0)}</strong></div><div class="tile"><span>Givers</span><strong>${givers}</strong></div></div>`);
        parts.push(`<section class="panel"><h2>Giving by ${r.by}</h2>${barChart(r.buckets.map((b) => ({ label: short(b.start, r.by), value: b.amount, tip: `${short(b.start, r.by)}: ${money(b.amount)} from ${b.count} gifts` })), { name: 'Giving', format: money })}<p><a class="button light" href="/admin/reports.csv?range=${r.key}">Download CSV</a></p></section>`);
        const sizes = [
          ['Under $25', 0, 2500],
          ['$25 to $49', 2500, 5000],
          ['$50 to $99', 5000, 10000],
          ['$100 to $249', 10000, 25000],
          ['$250 and up', 25000, Infinity],
        ].map(([label, low, high]) => ({ label, value: r.gifts.filter((gift) => gift.cents >= low && gift.cents < high).length }));
        parts.push(`<section class="panel"><h2>Gift sizes</h2>${rankBars(sizes)}</section>`);
      }
      if (on.events) {
        const events = desk.allEvents().filter((event) => event.capacity && event.date >= localDate(r.from) && event.date <= localDate(r.to));
        parts.push(`<section class="panel"><h2>Events with sign-ups in the range</h2>${events.length ? rankBars(events.map((event) => ({ label: `${event.title}, ${dateLabel(event.date)}`, value: (event.capacity - event.left) / event.capacity })), { format: percent }) : '<p>None.</p>'}</section>`);
      }
      return frame('/admin/reports', owner, bar, parts.join('\n'));
    },

    reportCsv(url) {
      const r = this.report(url);
      const first = r.by === 'day' ? 'Day' : r.by === 'week' ? 'Week starting' : 'Month';
      return r.kind === 'appointments'
        ? csv(r.buckets, [{ key: 'start', label: first }, { key: 'count', label: 'Appointments' }, { key: 'amount', label: 'Takings at typical prices (USD)', value: (b) => b.amount / 100 }])
        : csv(r.buckets, [{ key: 'start', label: first }, { key: 'count', label: 'Gifts' }, { key: 'amount', label: 'Given (USD)', value: (b) => b.amount / 100 }]);
    },

    settings({ owner, bar, said }) {
      return frame(
        '/admin/settings',
        owner,
        bar,
        `<section><h1>Settings</h1><p class="lede">The words and prices people see. Changes show at once.</p></section>
${said}
<form class="panel" method="post" action="/admin/settings">
  <h2>The business</h2>
  <label>About<textarea name="about" rows="2" maxlength="300" required>${escape(site.about)}</textarea></label>
  <label>Notice on the home page<span class="hint">Empty for none.</span><input name="notice" maxlength="200" value="${escape(site.notice ?? '')}"></label>
  <label>Hours<input name="hours" maxlength="120" required value="${escape(site.hours)}"></label>
  ${(site.services ?? [])
    .map(
      (svc) => `<h2>${escape(svc.name)}</h2><div class="filters"><label>Price as shown<input name="price-${svc.id}" maxlength="40" required value="${escape(svc.price)}"></label><label>Typical price, for reports ($)<input name="cents-${svc.id}" inputmode="decimal" maxlength="10" required value="${((svc.cents ?? 0) / 100).toFixed(2)}"></label></div><label>About<input name="about-${svc.id}" maxlength="200" required value="${escape(svc.about)}"></label>`,
    )
    .join('')}
  ${site.fund ? `<h2>${escape(site.fund.title)}</h2><label>About the fund<textarea name="fundAbout" rows="2" maxlength="300" required>${escape(site.fund.about)}</textarea></label>` : ''}
  <button type="submit">Save</button>
</form>`,
      );
    },

    outbox({ owner, bar }) {
      const list = desk.messages();
      return frame(
        '/admin/outbox',
        owner,
        bar,
        `<section><h1>Outbox</h1><p class="lede">This demo sends no real texts or email. What it would have sent is here, newest first.</p></section>
<section class="panel">${list.length ? `<div class="table-wrap"><table><thead><tr><th scope="col">When</th><th scope="col">To</th><th scope="col">Message</th></tr></thead><tbody>${list.slice(0, 100).map((one) => `<tr><td>${dateTime(one.at)}</td><td>${one.channel === 'sms' ? 'Text' : 'Email'} to ${escape(one.to)}</td><td>${one.subject ? `<strong>${escape(one.subject)}</strong><br>` : ''}<span style="white-space:pre-wrap">${escape(one.body)}</span></td></tr>`).join('')}</tbody></table></div>` : '<p>Nothing sent yet.</p>'}</section>`,
      );
    },
  };
}
