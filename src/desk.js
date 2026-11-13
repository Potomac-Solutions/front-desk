// The front desk: what the server knows, and what only it may decide.
//
// Everything lives in one Sync log (a SQLite file), read and written through the kit's store. The
// kit does the deciding: `hold` keeps each person's chair to one booking at a time and each event
// to its places, `pay` takes a gift once, `notify` sends the confirmations. This file knows the
// site's services, staff, events and forms, and the words. A site switches modules on in
// `src/site.js`; the ones it leaves off have no routes and write nothing.
//
//   slots/appt/<staff>/<day>/<HHMM>   a 15-minute piece of someone's chair      (kit hold)
//   busy/<day>                        { taken: { <staff>: [HHMM…] } }: live, so free times grey out
//   pending/<guest>                   the time a guest is holding while they fill in the details
//   appointments/<key>                a booking: service, who, when, the answers; booked or cancelled
//   events/<key>                      an event, and how many places are left (live)
//   places/event/<key>/p<n>           one place at an event                      (kit hold)
//   rsvps/<key>                       a sign-up: who, how many, which places
//   funds/<id>                        a fund, its goal and what's been given (live)
//   gifts/<key>                       a gift (kit pay, test mode)
//   inbox/<key>                       a form someone sent, for the staff
//   messages/<key>                    every text or email sent (the concept keeps them here)
import { createSyncServer } from '@zubra/sync/server';
import { sqliteLog } from '@zubra/sync/sqlite';
import { syncStore, serverOnly, SERVER_ONLY } from '@potomac-solutions/kit/store';
import { createHolds } from '@potomac-solutions/kit/hold';
import { createPay, testProvider } from '@potomac-solutions/kit/pay';
import { createNotify } from '@potomac-solutions/kit/notify';
import { moment } from '@potomac-solutions/kit/price';
import { sites } from './site.js';

const DAY_MS = 86_400_000;
const newKey = (letter) => `${letter}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
const keyOf = (letter) => new RegExp(`^${letter}[a-z0-9]{8,24}$`);
const minutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(-2));
const clock = (total) => `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
const piece = (total) => clock(total).replace(':', '');
const dayKey = (date) => date.replaceAll('-', '');

/** "9:15 am" */
export const timeLabel = (hhmm) => {
  const [hours, mins] = hhmm.split(':').map(Number);
  return `${((hours + 11) % 12) + 1}:${String(mins).padStart(2, '0')} ${hours < 12 ? 'am' : 'pm'}`;
};
/** "Fri 20 Nov" */
export const dateLabel = (date) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

/** The contact fields every booking and sign-up asks for. */
export const CONTACT = [
  { name: 'name', label: 'Your name', type: 'text', required: true },
  { name: 'phone', label: 'Phone', type: 'tel', required: true, hint: 'With the area code. We’ll text to confirm.' },
  { name: 'email', label: 'Email', type: 'email' },
];

/**
 * Read a form against its fields: the values, and the answers as [label, value] for the staff,
 * or the first thing wrong, in words.
 */
export function readFields(fields, form) {
  const values = {};
  const answers = [];
  for (const field of fields) {
    const raw = String(form.get(field.name) ?? '').trim().slice(0, field.type === 'textarea' ? 2000 : 200);
    const label = field.label;
    let value = raw;
    if (field.type === 'checkbox') {
      value = raw ? 'Yes' : '';
      if (field.required && !value) return { error: `Tick “${label}”.` };
    } else if (!raw) {
      if (field.required) return { error: `Fill in “${label}”.` };
    } else if (field.type === 'tel' && raw.replace(/\D/g, '').length < 10) {
      return { error: 'Give a phone number with its area code.' };
    } else if (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
      return { error: 'Check the email address.' };
    } else if (field.type === 'number' && !(Number.isInteger(Number(raw)) && Number(raw) >= (field.min ?? 0) && Number(raw) <= (field.max ?? 1e6))) {
      return { error: `Give a number from ${field.min ?? 0} to ${field.max ?? 1e6} for “${label}”.` };
    } else if (field.type === 'select' && !field.options.includes(raw)) {
      return { error: `Choose one for “${label}”.` };
    } else if (field.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      return { error: `Give a date for “${label}”.` };
    }
    values[field.name] = value;
    if (value) answers.push([label, value]);
  }
  return { values, answers };
}

export async function createDesk({ db = ':memory:', site: siteId = 'desk', now = Date.now, holdMs } = {}) {
  const site = typeof siteId === 'string' ? sites[siteId] : siteId;
  if (!site) throw new TypeError(`No site called ${siteId}`);
  const on = site.modules;
  holdMs ??= (site.holdMinutes ?? 10) * 60_000;

  const sync = createSyncServer({
    log: await sqliteLog(db),
    // Pages write nothing: every collection here is the server's.
    authorize: serverOnly(
      [...SERVER_ONLY, 'slots', 'slot-holds', 'busy', 'pending', 'appointments', 'events', 'places', 'place-holds', 'rsvps', 'funds', 'gifts', 'inbox', 'messages'],
      ({ kind }) => kind === 'read',
    ),
    // A page reads which times are taken, the events' places left and the fund: no names.
    scope: () => ({ busy: true, events: true, funds: true }),
  });
  const store = await syncStore(sync);

  const chairs = createHolds({ store, holdMs, ceilingMs: 3 * holdMs, max: 24, names: { units: 'slots', holders: 'slot-holds' }, now });
  const places = createHolds({ store, holdMs: 60_000, max: site.partyMax ?? 8, names: { units: 'places', holders: 'place-holds' }, now });
  const pay = createPay({ provider: testProvider(), store, now });
  const notify = createNotify({
    // The concept sends nothing: each message is kept, and the staff page shows them.
    send: async (message) => (await store.write('messages', newKey('s'), { ...message, at: now() }), { ok: true }),
    templates: {
      booked: ({ name, what, when }) => ({ subject: 'Booked', body: `${name}, you’re booked for ${what}, ${when}. Reply or call to change it. ${site.name}` }),
      cancelled: ({ name, what, when }) => ({ subject: 'Cancelled', body: `${name}, your ${what} on ${when} is cancelled. ${site.name}` }),
      signedUp: ({ name, what, when, count }) => ({ subject: 'Signed up', body: `${name}, you’re signed up for ${what}, ${when} (${count} ${count === 1 ? 'place' : 'places'}). ${site.name}` }),
      thanks: ({ name, amount, fund }) => ({ subject: 'Thank you', body: `${name}, thank you for your gift of ${amount} to ${fund}. ${site.name}` }),
    },
  });
  const tell = (values, template, data) => notify.notify({ sms: values.phone, ...(values.email ? { email: values.email } : {}) }, template, data);

  const today = () => moment(new Date(now()), site.timeZone);
  /** The next `daysAhead` days on the site's clock: `{ date, day }`. */
  const upcoming = () => Array.from({ length: site.daysAhead ?? 14 }, (_, i) => moment(new Date(now() + i * DAY_MS), site.timeZone));

  // ---- Seeds: the first time this site runs on this log ----------------------------------------
  if (on.events && !store.under('events').length) {
    for (const event of site.events) {
      const date = moment(new Date(now() + event.inDays * DAY_MS), site.timeZone).date;
      const { inDays, ...rest } = event;
      await store.write('events', newKey('e'), { ...rest, date, left: event.capacity });
    }
  }
  if (on.giving && !store.get('funds', site.fund.id)) {
    await store.write('funds', site.fund.id, { title: site.fund.title, goal: site.fund.goal, raised: site.fund.raised, gifts: 0 });
  }

  // ---- Appointments -----------------------------------------------------------------------------
  const service = (id) => site.services?.find((one) => one.id === id) ?? null;
  const person = (id) => site.staff?.find((one) => one.id === id) ?? null;
  const poolFor = (staffId, date) => `appt/${staffId}/${dayKey(date)}`;
  /** The 15-minute pieces a booking of `mins` starting at `start` takes. */
  const run = (start, mins) => Array.from({ length: Math.ceil(mins / site.slotMinutes) }, (_, i) => piece(minutes(start) + i * site.slotMinutes));
  /** Who can do a service on a date: one person, or everyone who can ('any'). */
  function whoCan(svc, staffChoice, date) {
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    return (site.staff ?? []).filter((one) => one.does.includes(svc.id) && one.days.includes(weekday) && (staffChoice === 'any' || staffChoice === one.id));
  }
  /** Whether one person's chair is free for a run, now. */
  function freeFor(one, svc, date, start) {
    const from = minutes(start);
    if (from < minutes(one.opens) || from + svc.minutes > minutes(one.closes)) return false;
    const taken = chairs.taken(poolFor(one.id, date));
    return run(start, svc.minutes).every((unit) => !taken.has(unit));
  }
  const soonest = (date) => (date === today().date ? minutes(today().time) + (site.leadMinutes ?? 0) : 0);

  /** Which pieces of each chair are taken or held on a day: the live document pages follow. */
  function busyOn(date) {
    const day = {};
    for (const one of site.staff ?? []) day[one.id] = [...chairs.taken(poolFor(one.id, date)).keys()].sort();
    return day;
  }
  const refreshBusy = (date) => store.write('busy', dayKey(date), { taken: busyOn(date) });

  /**
   * The start times for a service on a date, each with whether someone is free then. The same
   * rule runs in the page's `free-times` element, which greys a time out live.
   */
  function times(svcId, staffChoice, date) {
    const svc = service(svcId);
    if (!svc || !upcoming().some((one) => one.date === date)) return [];
    const can = whoCan(svc, staffChoice, date);
    const starts = new Set();
    for (const one of can) {
      for (let at = minutes(one.opens); at + svc.minutes <= minutes(one.closes); at += site.slotMinutes) if (at >= soonest(date)) starts.add(clock(at));
    }
    return [...starts].sort().map((time) => ({ time, label: timeLabel(time), free: can.some((one) => freeFor(one, svc, date, time)) }));
  }

  /** Days ahead someone does a service, with how many start times are still free. */
  const days = (svcId, staffChoice) =>
    upcoming()
      .filter(({ date }) => service(svcId) && whoCan(service(svcId), staffChoice, date).length)
      .map(({ date }) => ({ date, label: dateLabel(date), free: times(svcId, staffChoice, date).filter((one) => one.free).length }));

  const appointmentWords = (appt) => ({ what: `${service(appt.service)?.name.toLowerCase()} with ${person(appt.staff)?.name}`, when: `${dateLabel(appt.date)} at ${timeLabel(appt.time)}` });

  // ---- Events ------------------------------------------------------------------------------------
  const eventPool = (key) => `event/${key}`;
  const placeIds = (event) => Array.from({ length: event.capacity ?? 0 }, (_, i) => `p${i + 1}`);
  const eventOf = (key) => (keyOf('e').test(key ?? '') ? store.get('events', key) : null);
  const eventWords = (event) => ({ what: event.title, when: `${dateLabel(event.date)} at ${timeLabel(event.starts)}` });
  // A guest's sign-up in progress, so a second press can't sign them up twice.
  const signing = new Set();
  const setLeft = (key, event) => store.write('events', key, { left: placeIds(event).length - places.taken(eventPool(key)).size });

  return {
    sync,
    store,
    site,
    on,
    newKey,
    service,
    person,

    // ---- Appointments ---------------------------------------------------------------------------
    days,
    times,
    busyOn,
    /** Who the guest may choose for a service: 'any', then each person who does it. */
    /** Who can do a service on a date (a person, or 'any'): what `free-times` checks against. */
    whoCan: (svcId, staffChoice, date) => (service(svcId) ? whoCan(service(svcId), staffChoice, date) : []),
    staffFor: (svcId) => (site.staff ?? []).filter((one) => one.does.includes(svcId)),

    /**
     * Hold a time while the guest fills in the details: the chair's pieces for that run, for
     * `holdMinutes`. One time per guest; choosing another lets the first go.
     */
    async holdTime(guest, form) {
      if (!on.appointments || !guest) return { error: 'Open the booking page again.' };
      const svc = service(String(form.get('service') ?? ''));
      const staffChoice = String(form.get('staff') ?? 'any');
      const date = String(form.get('date') ?? '');
      const time = String(form.get('time') ?? '');
      if (!svc || !(staffChoice === 'any' || person(staffChoice)) || !times(svc.id, staffChoice, date).some((one) => one.time === time)) return { error: 'Choose one of the times shown.' };
      const who = whoCan(svc, staffChoice, date).find((one) => freeFor(one, svc, date, time));
      if (!who) return { error: `${timeLabel(time)} was just taken. Choose another time.` };
      const before = store.get('pending', guest.pub);
      const pool = poolFor(who.id, date);
      const units = run(time, svc.minutes);
      // Nothing is awaited between the check and the hold, so two guests can't both get it.
      const held = await chairs.choose(guest.pub, pool, { units });
      if (held.error) return { error: `${timeLabel(time)} was just taken. Choose another time.` };
      if (before?.pool && before.pool !== pool) await chairs.release(guest.pub, before.pool);
      await store.write('pending', guest.pub, { service: svc.id, staff: who.id, date, time, pool, units, chose: staffChoice });
      await refreshBusy(date);
      if (before?.date && before.date !== date) await refreshBusy(before.date);
      return { ok: true, until: held.until };
    },

    /** The time a guest is holding, and until when; null when there's none. */
    pending(guest) {
      const mine = guest && store.get('pending', guest.pub);
      if (!mine?.service) return null;
      const held = chairs.held(guest.pub, mine.pool);
      return { ...mine, until: held.units.length === mine.units.length ? held.until : 0 };
    },

    /** Let go of the time a guest is holding. */
    async letGo(guest) {
      const mine = guest && store.get('pending', guest.pub);
      if (!mine?.service) return { ok: true };
      await chairs.release(guest.pub, mine.pool);
      await store.write('pending', guest.pub, { service: '' });
      await refreshBusy(mine.date);
      return { ok: true };
    },

    /**
     * Book the held time with the guest's details and the service's questions. A hold that ran
     * out is still booked if nobody took the time meanwhile.
     */
    async book(guest, form) {
      const mine = guest && store.get('pending', guest.pub);
      if (!mine?.service) return { error: 'Choose a time first.', back: '/' };
      const svc = service(mine.service);
      const read = readFields([...CONTACT, ...svc.intake], form);
      if (read.error) return read;
      const held = chairs.held(guest.pub, mine.pool).units;
      if (held.length !== mine.units.length) {
        const again = await chairs.choose(guest.pub, mine.pool, { units: mine.units });
        if (again.error) {
          await store.write('pending', guest.pub, { service: '' });
          await refreshBusy(mine.date);
          return { error: 'Sorry, someone booked that time while you were filling this in. Choose another.', back: `/book/${svc.id}?date=${mine.date}` };
        }
      }
      const confirmed = await chairs.confirm(guest.pub, mine.pool, mine.units);
      if (confirmed.error) return { error: 'That time has gone. Choose another.', back: `/book/${svc.id}?date=${mine.date}` };
      const key = newKey('a');
      const { name, phone, email } = read.values;
      const appt = { service: svc.id, staff: mine.staff, date: mine.date, time: mine.time, minutes: svc.minutes, pool: mine.pool, units: mine.units, name, phone, email, answers: read.answers.slice(3 - (email ? 0 : 1)), owner: guest.pub, status: 'booked', at: now() };
      await store.write('appointments', key, appt);
      await store.write('pending', guest.pub, { service: '' });
      await refreshBusy(mine.date);
      await tell(read.values, 'booked', { name, ...appointmentWords(appt) });
      return { ok: true, key };
    },

    /** An appointment the guest made (or any, for the staff), or null. */
    appointment(guest, key, { staff = false } = {}) {
      const appt = keyOf('a').test(key ?? '') ? store.get('appointments', key) : null;
      return appt && (staff || (guest && appt.owner === guest.pub)) ? { key, ...appt, ...appointmentWords(appt) } : null;
    },
    appointmentsFor: (guest) =>
      guest
        ? store
            .under('appointments')
            .filter((appt) => appt.owner === guest.pub && appt.status === 'booked' && appt.date >= today().date)
            .sort((a, b) => (a.date + a.time < b.date + b.time ? -1 : 1))
            .map((appt) => ({ ...appt, ...appointmentWords(appt) }))
        : [],

    /** Cancel: the guest, before it starts; the staff, any time. The chair is free again at once. */
    async cancel(guest, key, { staff = false } = {}) {
      const appt = this.appointment(guest, key, { staff });
      if (!appt) return { error: 'That isn’t one of your appointments.' };
      if (appt.status !== 'booked') return { error: 'That appointment is already cancelled.' };
      if (!staff && `${appt.date} ${appt.time}` <= `${today().date} ${today().time}`) return { error: 'That appointment has started. Call us.' };
      // The kit gives the chair's pieces back (they were the guest's, taken when booked).
      const freed = await chairs.free(appt.owner, appt.pool, appt.units);
      if (freed.error) return { error: 'That time has already been given back.' };
      await store.write('appointments', key, { status: 'cancelled', cancelledAt: now(), cancelledBy: staff ? 'staff' : 'guest' });
      await refreshBusy(appt.date);
      await tell(appt, 'cancelled', { name: appt.name, what: appt.what, when: appt.when });
      return { ok: true, appt };
    },

    /** The staff's day sheet: each person's bookings on a date, in order. */
    daySheet: (date) =>
      (site.staff ?? []).map((one) => ({
        ...one,
        appointments: store
          .under('appointments')
          .filter((appt) => appt.staff === one.id && appt.date === date && appt.status === 'booked')
          .sort((a, b) => (a.time < b.time ? -1 : 1))
          .map((appt) => ({ ...appt, ...appointmentWords(appt) })),
      })),
    upcoming,
    today: () => today().date,

    /** Let go of every hold whose time is up, so every page sees the time free. */
    async sweep() {
      const lapsed = await chairs.sweep();
      if (lapsed && on.appointments) for (const { date } of upcoming()) await refreshBusy(date);
      return lapsed;
    },

    // ---- Events -----------------------------------------------------------------------------------
    /** Events from today on, soonest first. */
    events: () =>
      store
        .under('events')
        .filter((event) => event.date >= today().date)
        .sort((a, b) => (a.date + a.starts < b.date + b.starts ? -1 : 1)),
    event: (key) => {
      const event = eventOf(key);
      return event ? { key, ...event } : null;
    },

    /** Sign up for an event with places: `count` of them, all or none. */
    async signUp(guest, key, form) {
      const event = eventOf(key);
      if (!on.events || !guest || !event || event.date < today().date) return { error: 'That event isn’t on the calendar.' };
      if (!event.capacity) return { error: 'No need to sign up for this one. Just come.' };
      const count = Number(form.get('count') ?? 1);
      if (!Number.isInteger(count) || count < 1 || count > site.partyMax) return { error: `Choose from 1 to ${site.partyMax} places.` };
      const read = readFields(CONTACT, form);
      if (read.error) return read;
      const mark = `${key}/${guest.pub}`;
      if (signing.has(mark) || store.under('rsvps').some((one) => one.event === key && one.owner === guest.pub && one.status === 'booked')) return { error: 'You’re already signed up. Cancel that first to change it.' };
      signing.add(mark);
      try {
        return await this.takePlaces(guest, key, event, count, read.values);
      } finally {
        signing.delete(mark);
      }
    },
    /** (signUp's second half, once the party is checked) */
    async takePlaces(guest, key, event, count, values) {
      const pool = eventPool(key);
      const taken = places.taken(pool);
      const free = placeIds(event).filter((id) => !taken.has(id));
      if (free.length < count) return { error: free.length ? `Only ${free.length} ${free.length === 1 ? 'place' : 'places'} left.` : 'Sorry, it’s full.' };
      // Chosen and held with nothing awaited in between: two parties can't get the same place.
      const held = await places.choose(guest.pub, pool, { units: free.slice(0, count) });
      if (held.error) return { error: 'Those places just went. Try again.' };
      await places.confirm(guest.pub, pool, held.units);
      const rsvp = newKey('r');
      await store.write('rsvps', rsvp, { event: key, title: event.title, count, places: held.units, name: values.name, phone: values.phone, email: values.email, owner: guest.pub, status: 'booked', at: now() });
      await setLeft(key, event);
      await tell(values, 'signedUp', { name: values.name, count, ...eventWords(event) });
      return { ok: true, key: rsvp };
    },
    rsvp(guest, key, { staff = false } = {}) {
      const rsvp = keyOf('r').test(key ?? '') ? store.get('rsvps', key) : null;
      return rsvp && (staff || (guest && rsvp.owner === guest.pub)) ? { key, ...rsvp, event: { key: rsvp.event, ...store.get('events', rsvp.event) } } : null;
    },
    rsvpsFor: (guest) => (guest ? store.under('rsvps').filter((one) => one.owner === guest.pub && one.status === 'booked' && (store.get('events', one.event)?.date ?? '') >= today().date) : []),
    rsvpsAt: (eventKey) => store.under('rsvps').filter((one) => one.event === eventKey && one.status === 'booked'),
    async cancelRsvp(guest, key) {
      const rsvp = this.rsvp(guest, key);
      if (!rsvp || rsvp.status !== 'booked') return { error: 'That isn’t one of your sign-ups.' };
      const freed = await places.free(rsvp.owner, eventPool(rsvp.event.key), rsvp.places);
      if (freed.error) return { error: 'Those places have already been given back.' };
      await store.write('rsvps', key, { status: 'cancelled', cancelledAt: now() });
      await setLeft(rsvp.event.key, rsvp.event);
      return { ok: true, rsvp };
    },

    // ---- Giving ---------------------------------------------------------------------------------
    fund: () => (on.giving ? { id: site.fund.id, ...store.get('funds', site.fund.id) } : null),
    /** A gift, charged once even if the button is pressed twice (the key is made with the page). */
    async give(guest, form) {
      if (!on.giving || !guest) return { error: 'Open the giving page again.' };
      const key = String(form.get('gift') ?? '');
      if (!keyOf('g').test(key)) return { error: 'Open the giving page again.' };
      const before = store.get('gifts', key);
      if (before) return before.owner === guest.pub ? { ok: true, again: true, cents: before.cents } : { error: 'Open the giving page again.' };
      const other = String(form.get('other') ?? '').trim();
      const cents = other ? Math.round(Number(other.replace(/[$,]/g, '')) * 100) : Number(form.get('amount'));
      if (!Number.isInteger(cents) || cents < 100 || cents > 1_000_000) return { error: 'Choose an amount from $1 to $10,000.' };
      const read = readFields([{ name: 'name', label: 'Your name', type: 'text', required: true }, { name: 'email', label: 'Email', type: 'email' }], form);
      if (read.error) return read;
      const paid = await pay.pay({ id: `gift/${key}`, cents, method: { card: String(form.get('card') ?? '') }, description: `${site.fund.title} (test mode)` });
      if (!paid.ok) return { error: paid.error === 'declined' ? 'That card was declined. Try another.' : paid.error === 'in-progress' ? 'Your gift is already going through.' : 'That didn’t go through. Try again.' };
      await store.write('gifts', key, { fund: site.fund.id, cents, name: read.values.name, email: read.values.email, ref: paid.ref, owner: guest.pub, at: now() });
      const fund = store.get('funds', site.fund.id);
      await store.write('funds', site.fund.id, { raised: fund.raised + cents, gifts: fund.gifts + 1 });
      if (read.values.email) await notify.notify({ email: read.values.email }, 'thanks', { name: read.values.name, amount: `$${(cents / 100).toFixed(2)}`, fund: site.fund.title });
      return { ok: true, cents };
    },
    gifts: () => store.under('gifts').sort((a, b) => b.at - a.at),

    // ---- Forms and the inbox ------------------------------------------------------------------------
    form: (id) => site.forms.find((one) => one.id === id) ?? null,
    async send(id, form) {
      const which = this.form(id);
      if (!which) return { error: 'That form isn’t here.' };
      const read = readFields(which.fields, form);
      if (read.error) return read;
      await store.write('inbox', newKey('m'), { form: id, title: which.title, answers: read.answers, name: read.values.name ?? '', phone: read.values.phone ?? '', handled: false, at: now() });
      return { ok: true };
    },
    inbox: () => store.under('inbox').sort((a, b) => Number(a.handled) - Number(b.handled) || b.at - a.at),
    async handled(key) {
      if (!keyOf('m').test(key ?? '') || !store.get('inbox', key)) return { error: 'That message isn’t in the inbox.' };
      await store.write('inbox', key, { handled: true });
      return { ok: true };
    },
    messages: () => store.under('messages').sort((a, b) => b.at - a.at),
  };
}
