// The page around the components: the head, the bar across the top, the foot, and the connection
// to the log. One server runs several businesses, so the stylesheets in public/ carry defaults
// and each page sets its own business's colours and heading typeface over them (`theme`), from
// `colours` and `look` in src/site.js.
import { asset, photo, FONT_CSS } from './assets.js';

export const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Small drawings, as inline SVG. Photographs are files in public/photos/, named `<site>-<what>`. */
export const art = {
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s7-6.200 7-11a7 7 0 0 0-14 0c0 4.800 7 11 7 11z"/><circle cx="12" cy="10" r="2.500"/></svg>',
  people: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.500"/><path d="M2.500 20a6.500 6.500 0 0 1 13 0M16 4.800a3.500 3.500 0 0 1 0 6.400M18 14.500a6.500 6.500 0 0 1 3.500 5.500"/></svg>',
};

const rgb = (hex) => hex.replace('#', '').match(/../g).map((part) => parseInt(part, 16)).join(' ');
/** This business's colours and type, over the stylesheets' defaults. */
export function theme(site) {
  const c = site.colours;
  const l = site.look;
  return `:root{--paper:${c.background};--paper-deep:${c.muted};--ink-soft:${c.mutedForeground};--brand:${c.primary};--brand-deep:${l.night};--brand-rgb:${rgb(c.primary)};--night:${l.night};--night-rgb:${rgb(l.night)};--shade-rgb:${rgb(l.shade)};--hot:${l.hot};--hot-ink:${l.hotInk};--hot-rgb:${rgb(l.hot)};--glow:${l.glow};--glow-hi:${l.glowHi};--glow-rgb:${rgb(l.glow)};--on-glow:${l.night};--line:${c.border};--muted:${c.muted};--note:${c.muted};--radius:${l.radius};--font-heading:${l.heading};--soft:${l.soft}}${l.caps ? '.hero h1,.hero .tag,.banner h2,.wordmark b{text-transform:uppercase;letter-spacing:0.01em}' : ''}`;
}
/** The business's initials on its own colour: a mark until it has a logo. */
export const mark = (site) => `<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="31" fill="${site.look.night}"/><circle cx="32" cy="32" r="25.500" fill="none" stroke="${site.look.glow}" stroke-width="1.400"/><text x="32" y="41" text-anchor="middle" font-family="${site.look.heading.replace(/"/g, "'")}" font-size="26" font-weight="600" fill="${site.look.glow}">${escape(site.name.split(/\s+/).slice(0, 2).map((word) => word[0]).join(''))}</text></svg>`;
export const wordmark = (site, href = '/') => `<a class="wordmark" href="${href}">${mark(site)}<span><b>${escape(site.name.replace(/ (Volunteer Fire Company|Co\.)$/, ''))}</b><small>${escape(site.words.trade)}</small></span></a>`;

/**
 * `nav`: who is looking, for the header's links: `customer` (signed in), `staff` (on the staff).
 * `here` marks the current link. `landing` is the landing page: full-width sections and its own
 * stylesheet.
 */
export function layout({ title, site, body, nav = {}, here = '', landing = false }) {
  const on = site.modules;
  const link = (href, words, cls = '') => `<a href="${href}"${cls ? ` class="${cls}"` : ''}${here === href ? ' aria-current="page"' : ''}>${words}</a>`;
  const links = [
    ...(on.events ? [link('/events', 'Calendar', 'wide')] : []),
    ...(on.giving ? [link('/give', 'Give', 'wide')] : []),
    link('/#contact', 'Contact', 'wide'),
    link('/#visit', 'Visit', 'wide'),
    nav.customer ? link('/account', 'Account') : link('/account/sign-in', 'Sign in'),
    ...(nav.staff ? [link('/admin', 'Admin')] : []),
  ].join('');
  const cta = on.appointments ? ['/#book', 'Book now', 'Book'] : on.events ? ['/events', 'What’s on', 'What’s on'] : ['/#contact', 'Get in touch', 'Contact'];
  const hero = photo(`${site.id}-hero`);
  const fullTitle = landing ? `${site.name} · ${site.town}` : `${title} · ${site.name}`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>${escape(fullTitle)}</title>
  <meta name="description" content="${escape(site.about)}">
  <meta property="og:title" content="${escape(fullTitle)}">
  <meta property="og:description" content="${escape(site.about)}">
  <meta name="theme-color" content="${site.look.night}">
  <link rel="icon" href="${asset('favicon.svg')}" type="image/svg+xml">
  <link rel="preload" href="${asset('source-sans-3-latin-400-normal.woff2')}" as="font" type="font/woff2" crossorigin>${landing && hero ? `
  <link rel="preload" href="${hero}" as="image" fetchpriority="high">` : ''}
  <style>${FONT_CSS}</style>
  <link rel="stylesheet" href="${asset('base.css')}">
  <link rel="stylesheet" href="${asset(landing ? 'site.css' : 'customer.css')}">
  <style>${theme(site)}</style>
</head>
<body>
  <a class="skip" href="#main">Skip to the page</a>
  <header class="site-head"><div class="wrap bar">${wordmark(site)}<nav aria-label="Site">${links}<a class="bag" href="${cta[0]}"><span class="long">${cta[1]}</span><span class="short">${cta[2]}</span></a></nav></div></header>
  <main id="main"${landing ? ' class="landing"' : ''}>
    ${body}
  </main>
  <footer class="site-foot"><div class="wrap">
    <div class="cols">
      <div>${wordmark(site)}<p>${escape(site.about)}</p><p>${escape(site.town)}</p></div>
      <div><h2>Hours</h2><p>${escape(site.hours)}</p></div>
      <div><h2>Find</h2><ul><li><a href="/">Home</a></li>${on.appointments ? '<li><a href="/#book">Book an appointment</a></li>' : ''}${on.events ? '<li><a href="/events">Calendar</a></li>' : ''}${on.giving ? '<li><a href="/give">Give</a></li>' : ''}<li><a href="/account">Your account</a></li></ul></div>
      <div><h2>Staff</h2><ul><li><a href="/staff">${on.appointments ? 'The front desk' : 'The office'}</a></li><li><a href="/admin">Admin sign-in</a></li></ul></div>
    </div>
    <div class="fine"><p>${escape(site.concept)}</p><p><a href="https://potomac.solutions">Built by Potomac Solutions</a></p></div>
  </div></footer>
  <script type="module">
    import { connect } from '@zubra/sync/connect';
    connect();
  </script>
</body>
</html>`;
}
