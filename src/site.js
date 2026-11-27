// The two sites Front Desk starts with: one office that takes appointments, one community group
// with a calendar and a fund. A business switches on the modules it needs; the code is the same.
// The owner edits the words and prices from the admin's settings; `cents` is a service's typical
// price, for the reports. The salon is paid in the chair; only colour, the long one, takes a
// deposit online to book (`deposit`, in cents), on Clover's page.
//
// Made-up businesses in real towns, so the demo reads like the trade without being anyone's.
//
// Form fields, for intake questions and forms alike:
//   { name, label, type: 'text' | 'tel' | 'email' | 'textarea' | 'select' | 'date' | 'number' | 'checkbox',
//     required, options (select), min and max (number), hint }

const contact = [
  { name: 'name', label: 'Your name', type: 'text', required: true },
  { name: 'phone', label: 'Phone', type: 'tel', required: true, hint: 'With the area code.' },
  { name: 'email', label: 'Email', type: 'email' },
];

export const sites = {
  desk: {
    id: 'desk',
    name: 'Yough Valley Hair Co.',
    town: 'Oakland, Maryland',
    timeZone: 'America/New_York',
    hours: 'Tuesday to Saturday, by appointment',
    concept: 'Concept by Potomac Solutions. Yough Valley Hair Co. is a made-up salon; no appointment here is real.',
    about: 'Two chairs on Second Street. Book a chair online, any time; we’ll text to confirm.',
    notice: 'Walk-ins welcome on Saturdays when a chair is free.',
    colours: { primary: '#3a2a25', accent: '#c98f7c', background: '#faf7f5', border: '#e8ddd7', muted: '#f3ece8', mutedForeground: '#6b5b54' },
    // How the public pages look: the dark and the bright beside `colours`, the heading typeface, and
    // the few words the landing page adds around what the owner edits (`about`, `notice`, services).
    look: { night: '#231916', shade: '#140d0b', hot: '#9e5a47', hotInk: '#824636', glow: '#f1d9cf', glowHi: '#f8e8e1', heading: '"Cormorant Garamond", "Iowan Old Style", Georgia, serif', soft: 'italic 600', radius: '0.9rem' },
    words: {
      trade: 'Hair, by appointment',
      tagline: 'A good chair is worth booking.',
      first: 'Book an appointment',
      book: { kicker: 'No phone tag', heading: 'Pick a time. We’ll text to confirm.', text: 'See every free slot for the next two weeks, choose who you’d like, and hold it while you fill in the details.' },
      services: { kicker: 'What we do', lede: 'Prices are where they start; we’ll tell you before we begin if it’ll be more.' },
      forms: { kicker: 'Something bigger?', heading: 'Get in touch' },
      visit: 'Two chairs on Second Street. Street parking out front; the door with the copper handle.',
    },
    modules: { appointments: true, events: false, giving: false },
    // Appointments: each person's chair is a day of 15-minute pieces; a booking takes a run of them.
    slotMinutes: 15,
    leadMinutes: 60,
    daysAhead: 14,
    holdMinutes: 10,
    staff: [
      { id: 'jess', name: 'Jess', days: [2, 3, 4, 5, 6], opens: '09:00', closes: '17:00', does: ['cut', 'colour', 'kids'] },
      { id: 'marco', name: 'Marco', days: [3, 4, 5, 6], opens: '10:00', closes: '18:00', does: ['cut', 'beard', 'kids'] },
    ],
    services: [
      { id: 'cut', name: 'Cut and style', minutes: 45, price: 'From $38', cents: 3800, about: 'A wash, a cut and a blow-dry.', intake: [{ name: 'length', label: 'How much off?', type: 'select', options: ['A trim', 'A few inches', 'Something new'], required: true }] },
      {
        id: 'colour',
        name: 'Colour',
        minutes: 90,
        price: 'From $85',
        cents: 8500,
        about: 'All-over colour or a refresh of the roots.',
        // Paid online to book (on Clover's page), and taken off the bill. Cancel and it comes back.
        deposit: 2500,
        intake: [
          { name: 'patch', label: 'Have you had a patch test with us in the last six months?', type: 'select', options: ['Yes', 'No'], required: true, hint: 'If not, we’ll do one at the start; it takes a minute.' },
          { name: 'last', label: 'When did you last colour your hair?', type: 'select', options: ['Never', 'In the last two months', 'Longer ago'], required: true },
        ],
      },
      { id: 'beard', name: 'Beard trim', minutes: 30, price: '$20', cents: 2000, about: 'Shaped, lined up and hot-towelled.', intake: [] },
      { id: 'kids', name: 'Kids’ cut (under 12)', minutes: 30, price: '$22', cents: 2200, about: 'With a lollipop at the end.', intake: [{ name: 'child', label: 'Child’s first name', type: 'text', required: true }] },
    ],
    forms: [
      {
        id: 'wedding',
        title: 'Wedding party enquiry',
        intro: 'Hair for a wedding party, in the salon or on location. Tell us about the day and we’ll call with a quote.',
        fields: [...contact, { name: 'date', label: 'The wedding date', type: 'date', required: true }, { name: 'people', label: 'How many people', type: 'number', min: 1, max: 20, required: true }, { name: 'message', label: 'Anything else', type: 'textarea' }],
      },
    ],
  },

  community: {
    id: 'community',
    name: 'Pine Hollow Volunteer Fire Company',
    town: 'Pine Hollow, Maryland',
    timeZone: 'America/New_York',
    hours: 'Hall office open Tuesdays, 6 to 8 pm',
    concept: 'Concept by Potomac Solutions. Pine Hollow Volunteer Fire Company here is made up; no event or gift is real.',
    about: 'Neighbours keeping neighbours safe since 1952. Come to a breakfast, learn CPR, or give to the new engine.',
    notice: 'The hall is closed Thanksgiving week. Breakfast is back the Sunday after.',
    colours: { primary: '#7a1f1f', accent: '#e0b03c', background: '#faf7f2', border: '#e2d7c9', muted: '#f1e9dd', mutedForeground: '#6d5f55' },
    look: { night: '#1c1414', shade: '#0f0a0a', hot: '#9e2420', hotInk: '#7d1a17', glow: '#e3b23f', glowHi: '#f0c661', heading: '"Oswald", "Arial Narrow", Impact, sans-serif', soft: 'normal 600', radius: '0.4rem', caps: true },
    words: {
      trade: 'Volunteer Fire Company',
      tagline: 'Here when the tones drop.',
      first: 'See what’s on',
      events: { kicker: 'At the hall', heading: 'Coming up', text: 'Breakfasts, classes and bingo. Sign up from your phone and we’ll save your place.' },
      fund: { kicker: 'The engine fund' },
      forms: { kicker: 'Lend a hand', heading: 'Get in touch' },
      visit: 'The brick station on Main Street. The hall door is round the side, by the flagpole.',
    },
    modules: { appointments: false, events: true, giving: true },
    // Events start this many days from the first run, so the demo always has some ahead.
    events: [
      { title: 'All-you-can-eat pancake breakfast', inDays: 3, starts: '07:00', ends: '11:00', place: 'The fire hall', capacity: null, about: 'Pancakes, sausage, eggs and coffee. Pay at the door; kids under 6 eat free.' },
      { title: 'CPR and first-aid class', inDays: 6, starts: '18:00', ends: '21:00', place: 'The fire hall, upstairs', capacity: 12, about: 'American Heart Association card at the end. Twelve places; sign up so we have enough manikins.' },
      { title: 'Bingo night', inDays: 10, starts: '18:30', ends: '21:30', place: 'The fire hall', capacity: 80, about: 'Doors at 5:30. Kitchen open. Sign up to save a seat at a table.' },
      { title: 'Open house and engine rides', inDays: 17, starts: '12:00', ends: '16:00', place: 'The station', capacity: null, about: 'Meet the crew, sit in the engine, and see the new thermal camera.' },
    ],
    // Most a party can sign up for at once.
    partyMax: 8,
    fund: { id: 'engine', title: 'The new engine fund', goal: 2_500_000, raised: 1_840_000, about: 'Engine 6 is 31 years old. Every gift goes to its replacement.' },
    givingAmounts: [2500, 5000, 10000],
    forms: [
      {
        id: 'volunteer',
        title: 'Join as a volunteer',
        intro: 'Firefighting, EMS, the auxiliary or fundraising: there’s a place for everyone. We’ll call to set up a visit.',
        fields: [...contact, { name: 'interest', label: 'What interests you', type: 'select', options: ['Firefighting', 'EMS', 'The auxiliary', 'Fundraising'], required: true }, { name: 'adult', label: 'I am 18 or older, or I’ll come with a parent or guardian', type: 'checkbox', required: true }],
      },
      {
        id: 'hall',
        title: 'Book the hall',
        intro: 'The hall seats 150, with a full kitchen. Tell us the date and we’ll call about it.',
        fields: [...contact, { name: 'date', label: 'The date', type: 'date', required: true }, { name: 'guests', label: 'How many guests', type: 'number', min: 1, max: 150, required: true }, { name: 'message', label: 'What’s the occasion', type: 'textarea' }],
      },
    ],
  },
};
