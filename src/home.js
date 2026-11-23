// The landing page: what a guest sees at `/`, for whichever business this address belongs to.
// A full-screen photograph, the business's name and one line, then a section for each module it
// has switched on: appointments (services as photo cards), events (what's coming up), giving
// (the fund, over a photograph), and its forms.
//
// What the owner edits (`about`, `notice`, services, the fund) comes from the site; the few words
// around them are `words` in src/site.js; photographs are files in public/photos/, `<site>-<what>`.
import { escape, art } from './layout.js';
import { photo } from './assets.js';

/**
 * `p` renders components; `mine` and `signed` are this guest's appointments and sign-ups; `fund`
 * and `fundBar` the fund and its live bar; `eventCards` the next events, already rendered; `said`
 * any signed message.
 */
export function landing({ site, mine = [], signed = [], fund = null, fundBar = '', eventCards = '', said = '', account = null }) {
  const on = site.modules;
  const w = site.words;
  const picture = (name, alt, { eager = false, cls = '' } = {}) => (photo(`${site.id}-${name}`) ? `<img${cls ? ` class="${cls}"` : ''} src="${photo(`${site.id}-${name}`)}" alt="${escape(alt)}"${eager ? ' fetchpriority="high"' : ' loading="lazy"'} decoding="async">` : '');
  const first = on.appointments ? ['#book', w.first] : on.events ? ['/events', w.first] : [`/forms/${site.forms[0].id}`, site.forms[0].title];
  const second = on.giving ? ['/give', 'Give'] : ['#visit', 'Find us'];

  return `<section class="hero">${picture('hero', '', { eager: true, cls: 'bg' })}
  <div class="wrap hero-words">
    <p class="kicker">${escape(site.town)}</p>
    <h1>${escape(site.name)}</h1>
    <p class="tag">${escape(w.tagline)}</p>
    <p class="lede">${escape(site.about)}</p>
    <div class="actions"><a class="go lg" href="${first[0]}">${escape(first[1])}</a><a class="button ghost lg" href="${second[0]}">${second[1]}</a></div>
  </div>
  <div class="hero-strip"><div class="wrap"><p>${escape(site.hours)}</p>${on.appointments ? `<p>With ${site.staff.map((one) => escape(one.name)).join(' and ')}</p>` : ''}</div></div>
</section>
<div class="wrap said">${said}${site.notice ? `<p class="bulletin">${escape(site.notice)}</p>` : ''}
${mine.length ? `<section class="panel yours"><h2>Your appointments</h2><ul>${mine.map((appt) => `<li><a href="/a/${appt.key}">${escape(appt.when)}</a> · ${escape(appt.what)}</li>`).join('')}</ul></section>` : ''}
${signed.length ? `<section class="panel yours"><h2>You’re signed up</h2><ul>${signed.map((one) => `<li><a href="/r/${one.key}">${escape(one.title)}</a> · ${one.count} ${one.count === 1 ? 'place' : 'places'}</li>`).join('')}</ul></section>` : ''}</div>
${
  on.appointments
    ? `<section class="split"><div class="wrap">
  <div class="pic">${picture('chair', 'An empty chair in front of the mirror')}</div>
  <div class="words"><p class="kicker">${escape(w.book.kicker)}</p><h2>${escape(w.book.heading)}</h2><p>${escape(w.book.text)}</p><a class="go lg" href="#book">${escape(w.first)}</a></div>
</div></section>
<div class="sec menu"><div class="wrap">
  <header class="head center"><p class="kicker">${escape(w.services.kicker)}</p><h2 class="big" id="book">Book an appointment</h2><p>${escape(w.services.lede)}</p></header>
  <ul class="cards photo-cards">${site.services.map((svc) => `<li class="card"><div class="pic">${picture(svc.id, '')}</div><div class="body"><h3>${escape(svc.name)}</h3><p class="meta">${svc.minutes} minutes · ${escape(svc.price)}</p><p>${escape(svc.about)}</p><a class="go" href="/book/${svc.id}">Book</a></div></li>`).join('')}</ul>
</div></div>`
    : ''
}${
    on.events
      ? `<section class="split"><div class="wrap">
  <div class="pic">${picture('breakfast', 'Pancakes and coffee set out on long tables in the hall')}</div>
  <div class="words"><p class="kicker">${escape(w.events.kicker)}</p><h2>${escape(w.events.heading)}</h2><p>${escape(w.events.text)}</p><a class="go lg" href="/events">The whole calendar</a></div>
</div></section>
<div class="sec menu"><div class="wrap"><ul class="cards">${eventCards}</ul></div></div>`
      : ''
  }${
    fund
      ? `<section class="banner" id="fund">${picture('engine', '', { cls: 'bg' })}<div class="wrap"><p class="kicker">${escape(w.fund.kicker)}</p><h2>${escape(fund.title)}</h2><p>${escape(site.fund.about)}</p><div class="fund-box">${fundBar}</div><a class="go lg" href="/give">Give</a></div></section>`
      : ''
  }
<div class="sec" id="contact"><div class="wrap">
  <header class="head"><p class="kicker">${escape(w.forms.kicker)}</p><h2 class="big">${escape(w.forms.heading)}</h2></header>
  <ul class="cards">${site.forms.map((form) => `<li class="card plain"><h3>${escape(form.title)}</h3><p>${escape(form.intro)}</p><a class="go" href="/forms/${form.id}">Open the form</a></li>`).join('')}</ul>
</div></div>
<div class="sec dark" id="visit"><div class="wrap">
  <header class="head"><p class="kicker">Find us</p><h2 class="big">Visit</h2></header>
  <div class="visit">
    <div>${art.clock}<h3>Hours</h3><p><strong>${escape(site.hours)}</strong></p></div>
    <div>${art.pin}<h3>Where</h3><p><strong>${escape(site.town)}</strong></p><p>${escape(w.visit)}</p></div>
    <div>${art.people}<h3>${on.appointments ? 'Who' : 'Your account'}</h3>${on.appointments ? `<p><strong>${site.staff.map((one) => escape(one.name)).join(' and ')}</strong></p>` : ''}<p>${account ? '<a href="/account">Your account</a> has everything you’ve booked.' : '<a href="/account/sign-up">Make an account</a> to keep what you book in one place.'}</p></div>
  </div>
  <p class="visit-cta"><a class="go lg" href="${first[0]}">${escape(first[1])}</a></p>
</div></div>`;
}
