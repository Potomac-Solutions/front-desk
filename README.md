# Front Desk and Community

For the businesses and groups whose website is mostly a front desk: book an appointment, fill in a form, see what's on, sign up, give. Lawyers, insurance agents, accountants, salons and barbers, vets and daycares on one side; churches, volunteer fire companies, clubs, youth leagues, museums and libraries on the other. One app: a site switches on the modules it needs. A Potomac Solutions platform, built on the [kit](https://github.com/Potomac-Solutions/kit) and [Zubra](https://github.com/journey-to-code-org/zubra).

It starts with two sites, both made up:

- **Yough Valley Hair Co.** in Oakland, Maryland: a two-chair salon. Appointments with intake questions, and a wedding-party enquiry form.
- **Bittinger Volunteer Fire Company** in Bittinger, Maryland: an events calendar with sign-ups, a fund for a new engine, and forms to volunteer or book the hall.

No appointment, event or gift here is real. Payments are in test mode, and texts and emails aren't sent: the staff page shows each one instead.

## Try it

`npm install`, then `npm start` for the salon or `SITE=community npm start` for the fire company, and open http://localhost:3000. Two browser windows side by side (one private, so it's another person) show the live parts best.

**The salon**

1. **Book.** Choose **Colour**, then Jess (Marco doesn't do colour), a day and a time. The time is held for you for ten minutes while you answer the colour questions; then **Book it**.
2. **Watch the times.** In the other window, open the same day: your time is struck out, without a reload. Hold a time in one window and it greys out in the other; **Let this time go** and it's back.
3. **Anyone.** Book a cut with **Anyone**: a time stays open while either chair is free.
4. **The front desk.** Open **Staff** from the footer and sign in. The day sheet shows each chair's bookings with the answers; cancel one and the time is free again at once. **Texts and emails sent** shows the confirmations that would have gone out.
5. **A form.** Send a wedding-party enquiry; it's in the staff inbox, to mark handled.

**The fire company** (`SITE=community`)

1. **Sign up.** Open the CPR class and sign up for three places. The calendar in the other window counts down from 12 to 9, live. Cancel, and they're back.
2. **Give.** Give to the engine fund with any card number (`4000 0000 0000 0002` is declined, to see that). The total on the home page moves in every open window.
3. **Volunteer.** Send the volunteer form; the office sees it in the inbox.

Without JavaScript (turn it off in the browser's settings), all of it works the same.

## How it is put together

| Piece | Job |
| --- | --- |
| [Potomac kit](https://github.com/Potomac-Solutions/kit) (private) | `hold` (each chair's day in 15-minute pieces, held while you fill in the details, then booked, and given back with `free` when cancelled; each event's places, all of a party or none), `pay` (gifts, test provider, charged once), `notify` (confirmations, kept in an outbox here), `auth` (guest and staff cookies), `store` (the Sync log) |
| `@zubra/server` | Renders every page before any JavaScript runs |
| `@zubra/sync` | The log (one SQLite file). Which pieces of each chair are taken, each event's places left and the fund's total are documents only the server writes; pages follow them live, and never read who booked, signed up or gave |
| `src/site.js` | The two sites as data: modules switched on, staff and their hours, services with their questions, events, the fund, and every form's fields |
| `src/desk.js` | The deciding: free times, holds and bookings, sign-ups, gifts, forms against their fields, the inbox |
| `free-times`, `places-left`, `fund-progress` | The live parts |

## Run it

```sh
npm install      # needs read access to the private Potomac-Solutions/kit repository
npm start        # the salon, on http://localhost:3000
SITE=community npm start
npm test         # needs Chrome or Playwright's Chromium
```

Node 22.13 or later. `SESSION_SECRET` is required in production; `DATA_DIR` says where the database file goes (one per site).

## What the tests prove

The salon (`test/desk.test.js`):

1. Without JavaScript: a service, a person who does it, a day and a time; held while the questions are answered (each one needed and checked); booked, with the confirmation sent. Someone else finds the time taken and can't see or cancel the booking; the front desk sees it with the answers.
2. A held time is nobody else's, nor is a booking that would run into it (one that ends where it begins is fine); choosing another time, or letting go, frees it.
3. Two guests pressing the same time at the same moment: one holds it.
4. Free times are live: holding and letting go show at once on an open page, including the earlier times a long booking would run into; with **Anyone**, a time stays open until both chairs are taken.
5. A hold runs out: someone else may take the time, and the late booking is told; if nobody did, it still books. The sweep writes lapsed holds down for live pages.
6. Cancelling, by the guest or the front desk, frees the time at once and texts the guest; the desk's posts need signing in.
7. Only the times shown can be held: not before opening, past closing, off the quarter hour, on a day off, in the past, with someone who doesn't do the service, or for a service that isn't offered. With **Anyone**, a late cut goes to whoever is still working.
8. A form is checked against its fields (a date, a number in range, an email) and reaches the inbox, to be marked handled.
9. A page reads which times are taken and nothing else, even when it asks: no names, no phone numbers. It writes nothing, another site's post is refused, and the salon has no calendar or giving.
10. Today's times start an hour from now, on the quarter hour, and end by closing.

The fire company (`test/community.test.js`):

1. Without JavaScript: the calendar; an open event needs no sign-up; signing up for places, once; the office sees who's coming; cancelling gives the places back.
2. Places run out: never more than a party's limit or than are left; two parties for the last places at once, one gets in; no place is given twice; a double press signs up once.
3. Places left are live on every open calendar.
4. Giving: a declined card gives nothing; a gift is charged once even when pressed twice; the total moves live; amounts and names are checked, and a gift's page can't be reused by someone else.
5. The volunteer form needs its tick box and a real choice; the hall form's numbers are checked.
6. A page reads the events and the fund and nothing else; it writes nothing; the fire company has no appointments.

Every behaviour was broken on purpose once to check a test fails (43 of 45 caught). The two that can't be: a page may write nothing because every collection is the server's, and a booking's later pieces are checked before holding even though the kit's `hold` already refuses the whole run if any piece is taken. Both checks stay as safety belts.

## Not yet

- The owner's admin: services, staff hours, events, the fund and every form are data in `src/site.js` today.
- Several sites on one server, chosen by hostname (the kit's `tenancy`), so each office isn't a deployment of its own.
- Real texts and email (a sender behind the kit's `notify`), reminders the day before, staff accounts, and a real payment provider.
- Recurring events, a waiting list when an event is full, and deposits for appointments.
