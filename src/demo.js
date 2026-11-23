// The public demo (DEMO=1): both seeded businesses, open to anyone, staff side included.
//
// - The demo sign-ins (below) are the ones `bin/seed.js` makes. Each business's sign-in page shows
//   its own, and the customer sign-in page shows the customer, who has an account at both.
// - Nobody can change a demo account: not its password, roles, name or reset link, and nobody can
//   turn it off. Anything else a visitor does (bookings, sign-ups, gifts, people they invite)
//   lasts until the next reset.
// - Railway starts the demo with `npm run demo` (seed fresh, then serve). `nightly` exits once a
//   day at a quiet hour, and Railway's "always" restart policy starts it again: fresh data, the
//   same sign-ins, and appointments dated from today.
//
// Nothing here changes the app unless the server runs with DEMO=1.

export const DEMO = {
  desk: {
    owner: { email: 'owner@example.com', name: 'Rosa Dunmore', password: 'yough-owner-demo' },
    staff: { email: 'jess@example.com', name: 'Jess Calloway', password: 'yough-staff-demo' },
  },
  community: {
    owner: { email: 'owner@example.com', name: 'Dale Pruitt', password: 'pine-hollow-owner-demo' },
    staff: { email: 'office@example.com', name: 'Wren Abbott', password: 'pine-hollow-staff-demo' },
  },
  customer: { email: 'riley@example.com', name: 'Riley Morgan', password: 'front-desk-guest-demo' },
};

const REFUSED = { error: 'The demo accounts can’t be changed. Everything resets overnight.' };
const same = (email) => String(email ?? '').trim().toLowerCase();

/** One business's demo sign-ins (`site` is the tenant's site: `desk` or `community`). */
export const demoLogins = (site) => (DEMO[site] ? [['Owner', DEMO[site].owner], ['Staff', DEMO[site].staff]] : []);

/** The kit's staff, with every change to one of this business's demo accounts refused. */
export function lockedStaff(staff, site) {
  const logins = demoLogins(site);
  const emails = new Set(logins.map(([, account]) => same(account.email)));
  const isDemo = (account) => staff.list().some((one) => one.account === account && emails.has(same(one.email)));
  return Object.assign(Object.create(staff), {
    demoLogins: logins,
    resetLink: (by, account) => (isDemo(account) ? REFUSED : staff.resetLink(by, account)),
    setRoles: (by, account, roles) => (isDemo(account) ? REFUSED : staff.setRoles(by, account, roles)),
    setDisabled: (by, account, disabled) => (isDemo(account) ? REFUSED : staff.setDisabled(by, account, disabled)),
    endSessions: (account) => (isDemo(account) ? 0 : staff.endSessions(account)),
    changePassword: (who, current, next) => (isDemo(who?.account) ? REFUSED : staff.changePassword(who, current, next)),
  });
}

/** The kit's customers, with every change to the demo customer refused. */
export function lockedCustomers(customers) {
  const isDemo = (customer) => same(customers.get(customer)?.email) === DEMO.customer.email;
  return Object.assign(Object.create(customers), {
    // No reset link for the demo customer; the app answers as it does for an unknown email.
    resetToken: (email) => (same(email) === DEMO.customer.email ? null : customers.resetToken(email)),
    rename: (customer, name) => (isDemo(customer) ? REFUSED : customers.rename(customer, name)),
    setDisabled: (customer, disabled) => (isDemo(customer) ? REFUSED : customers.setDisabled(customer, disabled)),
    endSessions: (customer) => (isDemo(customer) ? 0 : customers.endSessions(customer)),
  });
}

const login = (escape, who, account) =>
  `<p><strong>${escape(who)}</strong><br>${escape(account.email)}<br>Password: ${escape(account.password)}</p>`;

/** Above a business's staff sign-in form. */
export const demoSignIn = (escape, logins = []) =>
  `<section class="panel demo"><h2>Try the staff side</h2><p>This is a demo. Sign in as the owner to see everything, or as staff to work the desk.</p>${logins.map(([who, account]) => login(escape, who, account)).join('')}<p class="hint">Everything you do here is cleared overnight. Nothing is really booked, given or sent.</p></section>`;

/** Above the customer sign-in form. */
export const guestSignIn = (escape) =>
  `<section class="panel demo"><h2>Try a customer account</h2>${login(escape, 'Customer', DEMO.customer)}<p class="hint">This is a demo. Everything is cleared overnight.</p></section>`;

/**
 * Exit once a day at `hour` (in `timeZone`), so the host restarts the demo with fresh data.
 * Returns `{ check, stop }`: `check` is what the timer runs every five minutes.
 */
export function nightly({ hour = 4, timeZone = 'America/New_York', now = Date.now, exit = () => process.exit(0), log = console.log } = {}) {
  const hourIn = (ms) => Number(new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(ms));
  const started = now();
  // Not in the first hour, so a restart during the reset hour doesn't loop.
  const check = () => {
    if (now() - started <= 60 * 60_000 || hourIn(now()) !== hour) return false;
    log('Demo reset: exiting so the host starts it again with fresh data.');
    exit();
    return true;
  };
  const timer = setInterval(check, 5 * 60_000);
  timer.unref?.();
  return { check, stop: () => clearInterval(timer) };
}
