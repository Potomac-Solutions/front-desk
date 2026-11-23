// The page around the staff's side: the front desk (or the office) and the admin. A sidebar at a
// desk; on a phone a bar on top, tabs along the bottom, and the sidebar as a sheet that opens
// from "Menu" (a link to #nav, so it works without JavaScript). Styles: public/base.css, then
// public/app.css, then this business's own colours.
import { CHART_CSS } from '@potomac-solutions/kit/charts';
import { asset, FONT_CSS } from './assets.js';
import { escape, theme, wordmark } from './layout.js';

/** `owner`: whether the signed-in person is one. `here` marks the current link; `waiting` is how many messages in the inbox aren't handled. */
export function shell({ title, site, body, owner = false, here = '', waiting = 0 }) {
  const on = site.modules;
  const link = (href, words, extra = '') => `<a href="${href}"${here === href ? ' aria-current="page"' : ''}>${words}${extra}</a>`;
  const count = waiting ? `<b aria-label="${waiting} to handle">${waiting}</b>` : '';
  const desk = on.appointments ? 'The front desk' : 'The office';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="robots" content="noindex, nofollow">
  <title>${escape(title)} · ${escape(site.name)} staff</title>
  <meta name="theme-color" content="${site.look.night}">
  <link rel="icon" href="${asset('favicon.svg')}" type="image/svg+xml">
  <script>document.documentElement.classList.add('js');try{var t=localStorage.getItem('theme');if(t==='dark'||t==='light')document.documentElement.dataset.theme=t}catch(e){}</script>
  <style>${FONT_CSS}${CHART_CSS}</style>
  <link rel="stylesheet" href="${asset('base.css')}">
  <link rel="stylesheet" href="${asset('app.css')}">
  <style>${theme(site)}</style>
</head>
<body class="staff">
  <a class="skip" href="#main">Skip to the page</a>
  <div class="shell">
    <header class="topbar">${wordmark(site, '/staff')}<a class="menu" href="#nav">Menu</a></header>
    <aside class="side" id="nav">
      <a class="close" href="#main">Close</a>
      ${wordmark(site, '/staff')}
      <nav aria-label="Staff">
        <small>Today</small>${link('/staff', desk)}${link('/admin/inbox', 'Inbox', count)}
        <small>Books</small>${link('/admin', 'Overview')}${on.appointments ? link('/admin/appointments', 'Appointments') : ''}${on.events ? link('/admin/events', 'Events') : ''}${on.giving ? link('/admin/gifts', 'Giving') : ''}${link('/admin/customers', 'Customers')}${
          owner ? `
        <small>Owner</small>${link('/admin/reports', 'Reports')}${link('/admin/settings', 'Settings')}${link('/staff/people', 'Staff')}${link('/admin/outbox', 'Outbox')}` : ''
        }
      </nav>
      <details class="keys"><summary>Keys</summary><dl><dt><kbd>d</kbd></dt><dd>${desk}</dd><dt><kbd>i</kbd></dt><dd>Inbox</dd><dt><kbd>o</kbd></dt><dd>Overview</dd><dt><kbd>/</kbd></dt><dd>Search</dd><dt><kbd>?</kbd></dt><dd>This list</dd></dl></details>
      <div class="me">
        <a href="/">The public page</a>
        <div class="row"><button type="button" data-theme-toggle data-js-only>Dark theme</button></div>
      </div>
    </aside>
    <main id="main">
      ${body}
    </main>
    <nav class="tabs" aria-label="Quick">${link('/staff', on.appointments ? 'Front desk' : 'Office')}${link('/admin/inbox', 'Inbox', count)}${link('/admin', 'Overview')}${link('/admin/customers', 'Customers')}</nav>
  </div>
  <script type="module" src="${asset('app.js')}"></script>
  <script type="module">
    import { connect } from '@zubra/sync/connect';
    connect();
  </script>
</body>
</html>`;
}
