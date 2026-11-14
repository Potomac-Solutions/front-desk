// The page around the components: the site's frame, its colours, and the connection to the log.
export const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const STYLE = `
  :root { --foreground: #1f2422; --card: #ffffff; --primary-foreground: #ffffff; --radius: 0.75rem; color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; font-size: 1.0625rem; line-height: 1.5; background: var(--background); color: var(--foreground); }
  a:not(.action-button, .go, .button) { color: inherit; }
  :focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
  .concept { margin: 0; padding: 0.45rem 1rem; background: var(--accent); color: #1f1a10; font-size: 0.85rem; font-weight: 600; text-align: center; }
  .site-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.5rem 1rem; padding: 1rem clamp(1rem, 4vw, 2.5rem); background: var(--primary); color: var(--primary-foreground); }
  .site-head a { font-size: 1.35rem; font-weight: 800; text-decoration: none; }
  .site-head span { opacity: 0.85; font-size: 0.9rem; }
  main { width: min(60rem, 100% - 2 * clamp(1rem, 4vw, 2.5rem)); margin: 0 auto; padding: 2rem 0 3rem; display: grid; gap: 1.75rem; }
  h1 { margin: 0; font-size: clamp(1.9rem, 5vw, 2.75rem); line-height: 1.1; }
  h2 { margin: 0; font-size: 1.3rem; }
  .lede { margin: 0.4rem 0 0; color: var(--muted-foreground); }
  .go { justify-self: start; padding: 0.55rem 1rem; border-radius: 0.5rem; background: var(--primary); color: var(--primary-foreground); font-weight: 700; text-decoration: none; }
  .panel { display: grid; gap: 0.9rem; align-content: start; padding: 1.1rem 1.2rem; border-radius: var(--radius); background: var(--card); box-shadow: 0 0 0 1px var(--border); }
  .panel ul { margin: 0; padding-left: 1.2rem; }
  .panel.demo { gap: 0.5rem; box-shadow: 0 0 0 2px var(--accent); }
  .panel.demo p { margin: 0; }
  .notice { margin: 0; padding: 0.6rem 0.9rem; border-radius: 0.5rem; background: #fde4e1; color: #7a1f17; }
  .ok { margin: 0; padding: 0.6rem 0.9rem; border-radius: 0.5rem; background: #dff3e6; color: #13472a; }
  label { display: grid; gap: 0.3rem; font-weight: 600; }
  input, select, textarea { font: inherit; padding: 0.55rem 0.7rem; border-radius: 0.5rem; border: 1px solid var(--border); background: #fff; color: inherit; }
  .check { display: flex; gap: 0.5rem; align-items: start; font-weight: 400; }
  button, .button { font: inherit; font-weight: 700; padding: 0.65rem 1.1rem; border: 0; border-radius: 0.5rem; background: var(--primary); color: var(--primary-foreground); cursor: pointer; text-decoration: none; justify-self: start; }
  .button.light { background: var(--muted); color: var(--foreground); }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 0.5rem; text-align: left; border-bottom: 1px solid var(--border); vertical-align: top; }
  .site-foot { padding: 1.5rem clamp(1rem, 4vw, 2.5rem) 2.5rem; color: var(--muted-foreground); font-size: 0.9rem; }

  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); gap: 1rem; margin: 0; padding: 0; list-style: none; }
  .card { display: grid; gap: 0.5rem; align-content: start; padding: 1.1rem 1.2rem; border-radius: var(--radius); background: var(--card); box-shadow: 0 0 0 1px var(--border); }
  .card p { margin: 0; color: var(--muted-foreground); }
  .card h3 { margin: 0; font-size: 1.1rem; }
  .meta { font-weight: 700; color: var(--foreground) !important; }
  .go { justify-self: start; padding: 0.55rem 1rem; border-radius: 0.5rem; background: var(--primary); color: var(--primary-foreground); font-weight: 700; text-decoration: none; }
  .bulletin { margin: 0; padding: 0.7rem 1rem; border-radius: 0.5rem; background: var(--muted); border-left: 4px solid var(--accent); font-weight: 600; }
  .fields { display: grid; gap: 0.9rem; }
  .hint { font-weight: 400; font-size: 0.9rem; color: var(--muted-foreground); }
  .panel ul.days, .panel free-times ul { padding-left: 0; }
  .days { display: flex; flex-wrap: wrap; gap: 0.5rem; margin: 0; padding: 0; list-style: none; }
  .days a { display: grid; padding: 0.45rem 0.75rem; border-radius: 0.5rem; box-shadow: 0 0 0 1px var(--border); text-decoration: none; background: var(--card); }
  .days a[aria-current] { box-shadow: 0 0 0 2px var(--primary); font-weight: 700; }
  .days a small { color: var(--muted-foreground); }
  .row { display: flex; flex-wrap: wrap; gap: 0.6rem; align-items: end; }
  .inline { display: inline; }
  .done { opacity: 0.6; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 0.3rem 1rem; margin: 0; }
  dt { font-weight: 700; }
  dd { margin: 0; }
  .month { margin: 0.5rem 0 0; font-size: 1rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted-foreground); }`;

export function layout({ title, site, body }) {
  const c = site.colours;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>${escape(title)} · ${escape(site.name)}</title>
  <style>:root { --background: ${c.background}; --border: ${c.border}; --input: ${c.border}; --muted: ${c.muted}; --muted-foreground: ${c.mutedForeground}; --primary: ${c.primary}; --ring: ${c.primary}; --accent: ${c.accent}; }${STYLE}</style>
</head>
<body>
  <p class="concept">${escape(site.concept)}</p>
  <header class="site-head"><a href="/">${escape(site.name)}</a><span>${escape(site.town)} · ${escape(site.hours)}</span></header>
  <main>
    ${body}
  </main>
  <footer class="site-foot"><a href="/">Home</a>${site.modules.events ? ' · <a href="/events">Calendar</a>' : ''}${site.modules.giving ? ' · <a href="/give">Give</a>' : ''} · <a href="/staff">Staff</a></footer>
  <script type="module">
    import { connect } from '@zubra/sync/connect';
    connect();
  </script>
</body>
</html>`;
}
