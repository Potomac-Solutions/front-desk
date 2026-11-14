// The public demo: made-up businesses anyone can try, staff side included.
//
// - Each business starts with a demo owner, whose email and password the sign-in page shows.
// - Nobody can change the demo account: not its password, roles or reset link, and nobody can
//   turn it off. Anything else a visitor does (bookings, sign-ups, gifts, people they invite)
//   lasts until the next reset.
// - The data is kept in memory, so a restart is a reset. `nightly` asks the process to exit once
//   a day at a quiet hour; the host restarts it (Railway's "always" restart policy).
//
// Nothing here is used unless the server runs with DEMO=1.

export const DEMO_OWNER = { email: 'demo@example.com', name: 'Demo Owner', password: 'try the front desk' };

const REFUSED = { error: 'The demo account can’t be changed. Everything resets overnight.' };

/** Give a new business its demo owner. Returns the account id. */
export async function demoOwner(staff) {
  const made = await staff.accept(await staff.setup(), DEMO_OWNER);
  if (!made.ok) throw new Error(`demo owner: ${made.error}`);
  return made.account;
}

/** The kit's staff, with every change to the demo account refused. */
export function lockedDemo(staff, demoAccount) {
  return Object.assign(Object.create(staff), {
    resetLink: (by, account) => (account === demoAccount ? REFUSED : staff.resetLink(by, account)),
    setRoles: (by, account, roles) => (account === demoAccount ? REFUSED : staff.setRoles(by, account, roles)),
    setDisabled: (by, account, disabled) => (account === demoAccount ? REFUSED : staff.setDisabled(by, account, disabled)),
    endSessions: (account) => (account === demoAccount ? 0 : staff.endSessions(account)),
    changePassword: (who, current, next) => (who?.account === demoAccount ? REFUSED : staff.changePassword(who, current, next)),
  });
}

/** The panel above the sign-in form. */
export const demoSignIn = (escape) =>
  `<section class="panel demo"><h2>Try the staff side</h2><p>This is a demo. Sign in as the demo owner:</p><p><strong>Email</strong> ${escape(DEMO_OWNER.email)}<br><strong>Password</strong> ${escape(DEMO_OWNER.password)}</p><p class="hint">Everything you do here is cleared overnight. Nothing is really booked, given or sent.</p></section>`;

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
