// A customer's account pages: sign in, sign up, a forgotten password, and their own page.
import { escape } from './layout.js';
import { dateLabel, timeLabel } from './desk.js';

export const money = (cents) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 }).format(cents / 100);
const badge = (status, words) => `<span class="badge ${status}">${escape(words)}</span>`;

export function signIn({ problem = '', email = '' } = {}) {
  return `<section><h1>Sign in</h1><p class="lede">See your bookings on any device. No account? <a href="/account/sign-up">Make one</a>.</p></section>
${problem}
<form class="panel" method="post" action="/account/sign-in">
  <label>Email<input name="email" type="email" autocomplete="email" required value="${escape(email)}"></label>
  <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
  <button type="submit">Sign in</button>
  <p><a href="/account/forgot">Forgot your password?</a></p>
</form>`;
}

export function signUp({ problem = '', form = null } = {}) {
  return `<section><h1>Make an account</h1><p class="lede">Your bookings follow you to any device. Anything you’ve booked from this browser joins your account.</p></section>
${problem}
<form class="panel" method="post" action="/account/sign-up">
  <label>Your name<input name="name" autocomplete="name" required maxlength="80" value="${escape(form?.get('name') ?? '')}"></label>
  <label>Email<input name="email" type="email" autocomplete="email" required value="${escape(form?.get('email') ?? '')}"></label>
  <label>Password (at least 10 characters)<input name="password" type="password" autocomplete="new-password" minlength="10" required></label>
  <button type="submit">Make my account</button>
  <p>Already have one? <a href="/account/sign-in">Sign in</a>.</p>
</form>`;
}

export function forgot({ sent = false } = {}) {
  return `<section><h1>Reset your password</h1><p class="lede">We’ll email a link that works once, for an hour.</p></section>
${sent ? '<p class="ok" role="status">If there’s an account with that email, a link is on its way.</p>' : ''}
<form class="panel" method="post" action="/account/forgot">
  <label>Email<input name="email" type="email" autocomplete="email" required></label>
  <button type="submit">Send the link</button>
</form>`;
}

export function reset({ token, problem = '', works = true }) {
  if (!works) return `<section><h1>That link has expired</h1><p class="lede">It may have been used already. <a href="/account/forgot">Ask for a new one</a>.</p></section>`;
  return `<section><h1>Choose a new password</h1></section>
${problem}
<form class="panel" method="post" action="/account/reset">
  <input type="hidden" name="token" value="${escape(token)}">
  <label>New password (at least 10 characters)<input name="password" type="password" autocomplete="new-password" minlength="10" required></label>
  <button type="submit">Save and sign in</button>
</form>`;
}

/** The customer's own page: appointments, sign-ups and gifts, coming and past; their details. */
export function account({ desk, guest, customer, said }) {
  const { on } = desk;
  const today = desk.today();
  const { appointments, rsvps, gifts } = desk.history(guest);
  const coming = appointments.filter((appt) => appt.status === 'booked' && appt.date >= today).reverse();
  const past = appointments.filter((appt) => !(appt.status === 'booked' && appt.date >= today));
  const apptRows = (list) =>
    `<div class="table-wrap"><table><thead><tr><th scope="col">When</th><th scope="col">What</th><th scope="col">Status</th></tr></thead><tbody>${list
      .map((appt) => `<tr><td><a href="/a/${appt.key}">${escape(appt.when)}</a></td><td>${escape(appt.what)}</td><td>${appt.status === 'cancelled' ? badge('cancelled', 'Cancelled') : appt.date >= today ? badge('booked', 'Booked') : badge('past', 'Done')}</td></tr>`)
      .join('')}</tbody></table></div>`;
  const parts = [`<section><h1>Hello, ${escape(customer.name.split(' ')[0])}</h1><p class="lede">Everything you’ve booked with ${escape(desk.site.name)}.</p></section>`, said];
  if (on.appointments) {
    parts.push(`<section class="panel"><h2>Coming up</h2>${coming.length ? apptRows(coming) : '<p>Nothing booked. <a href="/#book">Book an appointment</a>.</p>'}</section>`);
    if (past.length) parts.push(`<section class="panel"><h2>Past and cancelled</h2>${apptRows(past.slice(0, 20))}</section>`);
  }
  if (on.events) {
    parts.push(`<section class="panel"><h2>Your sign-ups</h2>${rsvps.length ? `<div class="table-wrap"><table><thead><tr><th scope="col">Event</th><th scope="col">When</th><th scope="col" class="num">Places</th><th scope="col">Status</th></tr></thead><tbody>${rsvps
      .map((one) => `<tr><td><a href="/r/${one.key}">${escape(one.title)}</a></td><td>${escape(dateLabel(one.event.date))}, ${escape(timeLabel(one.event.starts))}</td><td class="num">${one.count}</td><td>${one.status === 'cancelled' ? badge('cancelled', 'Cancelled') : one.event.date >= today ? badge('booked', 'Signed up') : badge('past', 'Went')}</td></tr>`)
      .join('')}</tbody></table></div>` : '<p>None yet. <a href="/events">See the calendar</a>.</p>'}</section>`);
  }
  if (on.giving && gifts.length) {
    const total = gifts.reduce((sum, gift) => sum + gift.cents, 0);
    parts.push(`<section class="panel"><h2>Your giving</h2><p>${gifts.length} gift${gifts.length === 1 ? '' : 's'}, ${money(total)} in all. Thank you.</p><div class="table-wrap"><table><tbody>${gifts
      .map((gift) => `<tr><td>${escape(new Date(gift.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: desk.site.timeZone }))}</td><td class="num">${money(gift.cents)}</td><td class="muted">${escape(gift.ref)}</td></tr>`)
      .join('')}</tbody></table></div></section>`);
  }
  parts.push(`<section class="two">
  <form class="panel" method="post" action="/account/profile"><h2>Your details</h2><label>Name<input name="name" autocomplete="name" required maxlength="80" value="${escape(customer.name)}"></label><p class="muted">Email: ${escape(customer.email)}</p><button type="submit">Save</button></form>
  <div class="panel"><h2>Signing in</h2><p><a href="/account/forgot">Change your password</a> by email.</p><form method="post" action="/account/sign-out"><button class="button light" type="submit">Sign out</button></form></div>
</section>`);
  return parts.join('\n');
}
