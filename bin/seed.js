// Demo data for both businesses, so every admin page and report has something to show.
//
//   npm run seed            add to empty businesses (refuses if one already has data)
//   npm run seed -- --fresh start over: delete the database files first
//
// The salon: two staff accounts, thirty customers, four months of past appointments, and two
// weeks ahead booked through the real booking (held, then booked; the times grey out).
// The fire company: past events with sign-ups, a year of online gifts, and sign-ups for the
// events ahead through the real sign-up. Both get forms in the inbox.
// The names are made up and every address is @example.com. Run it with the server stopped.
import { existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp, DEFAULT_TENANTS } from '../server.js';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR ?? join(here, '..');
const tenants = process.env.TENANTS ? JSON.parse(process.env.TENANTS) : DEFAULT_TENANTS;
if (process.argv.includes('--fresh')) {
  for (const tenant of tenants) for (const end of ['', '-wal', '-shm']) if (existsSync(join(dataDir, `${tenant.id}.db${end}`))) rmSync(join(dataDir, `${tenant.id}.db${end}`));
}

// The demo sign-ins live in src/demo.js, so the public demo can show and protect them.
import { DEMO } from '../src/demo.js';
export { DEMO };

let seed = 20261115;
const random = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (list) => list[Math.floor(random() * list.length)];
const weighted = (pairs) => {
  let roll = random() * pairs.reduce((sum, [, w]) => sum + w, 0);
  for (const [value, w] of pairs) if ((roll -= w) < 0) return value;
  return pairs.at(-1)[0];
};
const FIRST = ['Avery', 'Blake', 'Casey', 'Drew', 'Emerson', 'Finley', 'Harper', 'Jamie', 'Kendall', 'Logan', 'Morgan', 'Noah', 'Parker', 'Quinn', 'Reese', 'Sawyer', 'Taylor', 'Peyton', 'Rowan', 'Skyler', 'Elliot', 'Hayden', 'Jordan', 'Kai', 'Lane', 'Micah', 'Sasha', 'Tatum', 'Wren', 'Ari'];
const LAST = ['Abbott', 'Barnes', 'Calloway', 'Dunmore', 'Ellison', 'Fairbanks', 'Garrett', 'Holloway', 'Iverson', 'Jessup', 'Kessler', 'Lowry', 'Marsh', 'Nolan', 'Oakley', 'Pruitt', 'Ramsey', 'Sutton', 'Thayer', 'Underwood', 'Vance', 'Whitaker', 'Yates', 'Zeller'];
const person = () => {
  const name = `${pick(FIRST)} ${pick(LAST)}`;
  return { name, email: `${name.toLowerCase().replace(' ', '.')}${Math.floor(random() * 90 + 10)}@example.com`, phone: `301-555-0${String(Math.floor(random() * 200)).padStart(3, '0')}` };
};
const DAY = 86_400_000;
const NOW = Date.now();
const addDays = (date, n) => new Date(Date.parse(`${date}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const localDate = (ms, zone) => new Date(ms).toLocaleDateString('en-CA', { timeZone: zone });
const at = (date, hour, minute = 0) => Date.parse(`${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00-05:00`);
const toMinutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
const hhmm = (total) => `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
let counter = 0;
const key = (letter, ms) => `${letter}${ms.toString(36)}${(counter++).toString(36).padStart(4, '0')}${Math.floor(random() * 36 ** 3).toString(36).padStart(3, '0')}`;

const server = await createApp({ tenants, dataDir, cache: false });
await server.open();

/** Staff accounts and customers, the same way for both kinds of business. */
async function people({ staff, customers, desk: { store } }, who, count) {
  if (!staff.needsOwner() || store.under('customers').length) throw new Error('already has data');
  await staff.accept(await staff.setup(), who.owner);
  const ownerView = staff.list().find((one) => one.email === who.owner.email);
  await staff.accept((await staff.invite(ownerView, { email: who.staff.email, name: who.staff.name, roles: ['staff'] })).token, who.staff);
  const staffView = staff.list().find((one) => one.email === who.staff.email);
  const accounts = [];
  const made = await customers.signUp(DEMO.customer);
  accounts.push({ id: made.customer, ...DEMO.customer, phone: '301-555-0142', at: NOW - 130 * DAY });
  for (let i = 0; i < count; i++) {
    const one = person();
    const signed = await customers.signUp({ ...one, password: `demo-password-${i}-${Math.floor(random() * 1e6)}` });
    if (signed.ok) accounts.push({ id: signed.customer, ...one, at: NOW - Math.floor(random() * 130 + 1) * DAY });
  }
  for (const one of accounts) await store.write('customers', one.id, { at: one.at });
  await customers.setDisabled(accounts.at(-1).id, true);
  return { ownerView, staffView, accounts };
}
/** A customer with an account who had joined by then, or someone booking as a guest. */
const whoBy = (accounts, when) => {
  const joined = accounts.slice(0, -1).filter((one) => one.at < when);
  return joined.length && random() < 0.55 ? { ...(random() < 0.05 ? accounts[0] : pick(joined)), account: true } : person();
};

async function seedSalon(space) {
  const { desk } = space;
  const { store } = desk;
  const { site } = desk;
  const { ownerView, staffView, accounts } = await people(space, DEMO.desk, 30);
  const today = desk.today();
  let past = 0;
  // Four months of past appointments: each working chair about two-thirds full.
  for (let date = addDays(today, -120); date < today; date = addDays(date, 1)) {
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    for (const chair of site.staff.filter((one) => one.days.includes(weekday))) {
      let t = toMinutes(chair.opens);
      while (t < toMinutes(chair.closes)) {
        const wanted = pick(chair.does);
        const svc = site.services.find((one) => one.id === wanted);
        if (t + svc.minutes > toMinutes(chair.closes)) break;
        if (random() < (weekday === 6 ? 0.8 : 0.6)) {
          const time = hhmm(t);
          const booked = Math.min(at(date, 8), at(addDays(date, -Math.floor(random() * 14 + 1)), 9 + Math.floor(random() * 11), Math.floor(random() * 60)));
          const who = whoBy(accounts, booked);
          const cancelled = random() < 0.07;
          const answers = svc.intake.map((field) => [field.label, field.type === 'select' ? pick(field.options) : pick(FIRST)]);
          await store.write('appointments', key('a', booked), {
            service: svc.id, staff: chair.id, date, time, minutes: svc.minutes, cents: svc.cents ?? 0, pool: `appt/${chair.id}/${date.replaceAll('-', '')}`, units: [],
            name: who.name, phone: who.phone ?? '301-555-0100', email: who.email, answers, owner: `seed-${counter}`, customer: who.account ? who.id : '',
            status: cancelled ? 'cancelled' : 'booked', at: booked, ...(cancelled ? { cancelledAt: booked + DAY, cancelledBy: random() < 0.5 ? 'guest' : 'staff' } : {}),
          });
          past++;
          t += svc.minutes;
        } else t += site.slotMinutes * 2;
      }
    }
  }
  // The next two weeks, through the real booking.
  let ahead = 0;
  for (let i = 0; i < 70; i++) {
    const svc = pick(site.services);
    const days = desk.days(svc.id, 'any').filter((one) => one.free);
    if (!days.length) continue;
    const day = days[Math.floor(Math.pow(random(), 1.6) * days.length)];
    const free = desk.times(svc.id, 'any', day.date).filter((one) => one.free);
    if (!free.length) continue;
    const time = pick(free).time;
    const who = whoBy(accounts, NOW);
    const guest = { pub: `seed-guest-${i}`, customer: who.account ? who.id : undefined };
    const held = await desk.holdTime(guest, new URLSearchParams({ service: svc.id, staff: 'any', date: day.date, time }));
    if (!held.ok) continue;
    const answers = Object.fromEntries(svc.intake.map((field) => [field.name, field.type === 'select' ? pick(field.options) : pick(FIRST)]));
    const done = await desk.book(guest, new URLSearchParams({ name: who.name, phone: who.phone ?? '301-555-0100', email: who.email, ...answers }));
    if (!done.ok) continue;
    await store.write('appointments', done.key, { at: NOW - Math.floor(random() * 10 + 1) * DAY - Math.floor(random() * DAY) });
    ahead++;
  }
  for (let i = 0; i < 6; i++) {
    const who = person();
    await desk.send('wedding', new URLSearchParams({ name: who.name, phone: who.phone, email: who.email, date: addDays(today, 30 + Math.floor(random() * 200)), people: String(2 + Math.floor(random() * 8)), message: pick(['Bride and four bridesmaids, updos.', 'Could you come to the venue at Wisp?', 'Mother of the bride too, please.', '']) }));
  }
  const inbox = desk.inbox();
  for (const one of inbox.slice(0, 3)) await desk.handled(one.key);
  for (const [i, one] of inbox.entries()) await store.write('inbox', one.key, { at: NOW - (i * 3 + 1) * DAY });
  await desk.audit(staffView, 'marked a form handled');
  await desk.audit(ownerView, 'changed the site’s words and prices');
  return `${accounts.length} customers, ${past} past appointments, ${ahead} ahead, ${inbox.length} enquiries`;
}

async function seedFireCompany(space) {
  const { desk } = space;
  const { store } = desk;
  const { site } = desk;
  const { ownerView, staffView, accounts } = await people(space, DEMO.community, 25);
  const today = desk.today();
  // Past events, every week or two, with sign-ups.
  const kinds = [
    { title: 'All-you-can-eat pancake breakfast', starts: '07:00', ends: '11:00', place: 'The fire hall', capacity: null, about: 'Pancakes, sausage, eggs and coffee.' },
    { title: 'CPR and first-aid class', starts: '18:00', ends: '21:00', place: 'The fire hall, upstairs', capacity: 12, about: 'American Heart Association card at the end.' },
    { title: 'Bingo night', starts: '18:30', ends: '21:30', place: 'The fire hall', capacity: 80, about: 'Doors at 5:30. Kitchen open.' },
    { title: 'Chicken barbecue', starts: '11:00', ends: '15:00', place: 'The station lot', capacity: 150, about: 'Half chickens, sides and a roll. Pre-order to be sure of one.' },
    { title: 'Smoke alarm and safety night', starts: '18:30', ends: '20:00', place: 'The fire hall', capacity: 40, about: 'Free smoke alarms for Pine Hollow homes while they last.' },
  ];
  let events = 0;
  let rsvps = 0;
  for (let date = addDays(today, -120); date < today; date = addDays(date, 7 + Math.floor(random() * 7))) {
    const kind = pick(kinds);
    const event = key('e', at(date, 9));
    let taken = 0;
    const came = new Set();
    if (kind.capacity) {
      const want = Math.round(kind.capacity * (0.45 + random() * 0.55));
      while (taken < want) {
        const count = Math.min(want - taken, weighted([[1, 30], [2, 40], [3, 15], [4, 15]]));
        const when = at(addDays(date, -Math.floor(random() * 14 + 1)), 8 + Math.floor(random() * 13));
        let who = whoBy(accounts, when);
        if (who.account && came.has(who.id)) who = person();
        if (who.account) came.add(who.id);
        const cancelled = random() < 0.06;
        await store.write('rsvps', key('r', when), { event, title: kind.title, count, places: [], name: who.name, phone: who.phone ?? '301-555-0100', email: who.email, owner: `seed-${counter}`, customer: who.account ? who.id : '', status: cancelled ? 'cancelled' : 'booked', at: when });
        if (!cancelled) taken += count;
        rsvps++;
      }
    }
    await store.write('events', event, { ...kind, date, left: kind.capacity ? kind.capacity - taken : null });
    events++;
  }
  // Sign-ups for the events ahead, through the real sign-up.
  for (const event of desk.events().filter((one) => one.capacity)) {
    const want = Math.round(event.capacity * (0.3 + random() * 0.4));
    for (let i = 0, filled = 0; filled < want && i < 60; i++) {
      const who = whoBy(accounts, NOW);
      const count = Math.min(want - filled, weighted([[1, 30], [2, 40], [3, 15], [4, 15]]));
      const guest = { pub: `seed-guest-${event.key}-${i}`, customer: who.account ? who.id : undefined };
      const done = await desk.signUp(guest, event.key, new URLSearchParams({ count: String(count), name: who.name, phone: who.phone ?? '301-555-0100', email: who.email }));
      if (done.ok) {
        filled += count;
        rsvps++;
        await store.write('rsvps', done.key, { at: NOW - Math.floor(random() * 6 + 1) * DAY - Math.floor(random() * DAY) });
      }
    }
  }
  // A year of online gifts, more in December and around the open house.
  let gifts = 0;
  let total = 0;
  for (let i = 365; i >= 1; i--) {
    const date = localDate(NOW - i * DAY, site.timeZone);
    const month = Number(date.slice(5, 7));
    const chance = month === 12 ? 0.6 : month === 11 ? 0.45 : 0.3;
    while (random() < chance && gifts < 1000) {
      const when = at(date, 7 + Math.floor(random() * 15), Math.floor(random() * 60));
      const who = whoBy(accounts, when);
      const cents = weighted([[1000, 15], [2500, 30], [5000, 28], [10000, 17], [25000, 7], [50000, 3]]);
      await store.write('gifts', key('g', when), { fund: site.fund.id, cents, name: who.name, email: who.email, ref: `test_${Math.floor(random() * 36 ** 8).toString(36)}`, owner: `seed-${counter}`, customer: who.account ? who.id : '', at: when });
      gifts++;
      total += cents;
    }
  }
  // The fund's total already counts these (and the gifts given at the hall).
  await store.write('funds', site.fund.id, { gifts });
  for (let i = 0; i < 7; i++) {
    const who = person();
    if (i % 2) await desk.send('volunteer', new URLSearchParams({ name: who.name, phone: who.phone, email: who.email, interest: pick(['Firefighting', 'EMS', 'The auxiliary', 'Fundraising']), adult: 'yes' }));
    else await desk.send('hall', new URLSearchParams({ name: who.name, phone: who.phone, email: who.email, date: addDays(today, 20 + Math.floor(random() * 150)), guests: String(30 + Math.floor(random() * 110)), message: pick(['A 50th anniversary party.', 'Family reunion, with the kitchen.', 'A baby shower.', 'Retirement dinner.']) }));
  }
  const inbox = desk.inbox();
  for (const one of inbox.slice(0, 2)) await desk.handled(one.key);
  for (const [i, one] of inbox.entries()) await store.write('inbox', one.key, { at: NOW - (i * 4 + 1) * DAY });
  await desk.audit(staffView, 'marked a form handled');
  await desk.audit(ownerView, 'added Bingo night to the calendar');
  return `${accounts.length} customers, ${events} past events, ${rsvps} sign-ups, ${gifts} gifts (${(total / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })})`;
}

const lines = [];
for (const tenant of tenants) {
  const space = await server.business(tenant.id);
  try {
    const summary = tenant.site === 'desk' ? await seedSalon(space) : await seedFireCompany(space);
    lines.push(`  ${space.desk.site.name}: ${summary}\n    http://${tenant.hosts[0]}:3000   owner ${DEMO[tenant.site].owner.email} / ${DEMO[tenant.site].owner.password}   staff ${DEMO[tenant.site].staff.email} / ${DEMO[tenant.site].staff.password}`);
  } catch (error) {
    if (error.message !== 'already has data') throw error;
    console.log(`${space.desk.site.name} already has data. Run \`npm run seed -- --fresh\` to start over.`);
    process.exit(1);
  }
}
console.log(`Seeded ${dataDir}:
${lines.join('\n')}
  Customer on both: ${DEMO.customer.email} / ${DEMO.customer.password}

These passwords are for this machine only. Then: npm start`);
process.exit(0);
