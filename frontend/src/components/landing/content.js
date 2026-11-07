/** Copy, sample figures, and layout tokens for the public landing page. */

export const EASE = [0.22, 1, 0.36, 1];

export const TITLE = 'Outreach Studio — Find leads. Write emails. Send at scale.';
export const DESCRIPTION =
  'Outreach Studio finds leads, writes the email, and sends the campaign — including the follow-up — from one workspace.';

export const NAV = [
  ['Features', '#features'],
  ['How it works', '#how'],
  ['Pricing', '#pricing'],
  ['Contact', '#contact'],
];

export const LOGOS = ['Northstar', 'Harbor', 'Fieldwork', 'Kite & Co', 'Brightline', 'Orbit', 'Beacon', 'Pulse'];

export const PROOF_STATS = [
  { value: 5000, suffix: '', label: 'Recipients in one campaign' },
  { value: 128, suffix: '', label: 'Leads scored in a search' },
  { value: 3, suffix: '', label: 'Days until the follow-up sends' },
];

export const HERO_DRAFTS = [
  'Hi Maya — Harbor just opened the London office. I can put a first note in front of a thousand hiring managers this week, in your voice.',
  'Hi Jonah — saw the seed round. If outbound is still a spreadsheet, the first campaign can leave this afternoon.',
];

export const HERO_PEOPLE = [
  ['AM', 'Amina Shah'],
  ['JL', 'Jonah Lee'],
  ['PR', 'Priya Raman'],
  ['CK', 'Chris Okonkwo'],
  ['EV', 'Elena Voss'],
];

export const FEATURES = [
  {
    key: 'recipients',
    span: 'os-span-4',
    kicker: 'Recipients',
    title: 'Every contact, one shelf.',
    body: 'Add people by hand or import a file. Search still feels quick when the library gets long.',
  },
  {
    key: 'groups',
    span: 'os-span-4',
    kicker: 'Groups',
    title: 'Send to the right room.',
    body: 'Founders, recruiters, or a list you picked by hand. Drop the group on the next campaign.',
  },
  {
    key: 'templates',
    span: 'os-span-4',
    kicker: 'Templates',
    title: 'The blank page is optional.',
    body: 'Save the subject and the body. Open them again when the next list is ready.',
  },
  {
    key: 'campaigns',
    span: 'os-span-7',
    kicker: 'Campaigns',
    title: 'One email. Five people, or five thousand.',
    body: 'A campaign sends the same message to a whole list in one run, then shows what was delivered.',
  },
  {
    key: 'agent',
    span: 'os-span-5',
    kicker: 'BD agent',
    title: 'It hunts. You decide who gets mail.',
    body: 'The agent searches, scores, and hands you a list. Nothing sends until you launch it.',
  },
  {
    key: 'automation',
    span: 'os-span-12',
    kicker: 'Automation',
    title: 'Find, write, send, follow up.',
    body: 'The loop you usually babysit — queued, so day three does not depend on you opening the tab.',
  },
];

export const STEPS = [
  {
    index: '01',
    title: 'Import or find leads',
    body: 'Bring a list you already have, or let the BD agent search and score a fresh one.',
  },
  {
    index: '02',
    title: 'Create a template',
    body: 'Write the note once. Keep the lines that should change, like a first name or a company.',
  },
  {
    index: '03',
    title: 'Launch the campaign',
    body: 'Pick the group, pick the mailbox you already tested, and send it in one run.',
  },
  {
    index: '04',
    title: 'Auto follow-ups',
    body: 'The next note is queued. You are not the person who has to remember Thursday.',
  },
];

export const DEMO_RECIPIENTS = ['Amina Shah', 'Jonah Lee', 'Priya Raman', 'Chris Okonkwo'];

export const AGENT_LINES = [
  { kind: 'sys', text: 'bd-agent · workspace ready' },
  { kind: 'think', text: 'Searching leads · Series A fintech, United States…' },
  { kind: 'ok', text: 'Found 128 prospects. 41 match the brief.' },
  { kind: 'think', text: 'Writing a first-touch email for each match…' },
  { kind: 'ok', text: 'Campaign ready. 41 drafts are waiting for you.' },
];

export const IMPACT = [
  { value: 48200, label: 'Emails sent' },
  { value: 3140, label: 'Leads found' },
  { value: 18, suffix: '%', label: 'Reply rate' },
];

export const PLANS = [
  {
    name: 'Starter',
    monthly: 39,
    blurb: 'For a founder sending the first real campaigns.',
    points: ['2,000 emails / month', 'Recipients, groups, and templates', '1 connected mailbox', 'Delivery status on every send'],
  },
  {
    name: 'Growth',
    monthly: 99,
    popular: true,
    blurb: 'For a team that wants the agent in the loop.',
    points: ['25,000 emails / month', 'BD agent lead search', 'Follow-ups on a schedule', '3 mailboxes'],
  },
  {
    name: 'Scale',
    monthly: 249,
    blurb: 'For outbound that already counts in the thousands.',
    points: ['100,000 emails / month', 'Priority sending queue', '10 mailboxes', 'Shared groups and templates'],
  },
];

export const QUOTES = [
  {
    quote: 'We used to paste the same note eighty times. Last Tuesday the campaign went to 1,400 founders before lunch.',
    name: 'Lina Ortega',
    role: 'Partner, Northstar',
  },
  {
    quote: 'The agent handed us 60 scored leads. We threw out 15, sent the rest, and booked four calls.',
    name: 'Marcus Adeyemi',
    role: 'Business development, Harbor',
  },
  {
    quote: 'Follow-ups used to die in my drafts. They go out on day three without me opening the tab.',
    name: 'Jonah Ellis',
    role: 'Founder, Kite & Co',
  },
];

export const FAQS = [
  {
    q: 'What does the BD agent actually do?',
    a: 'It searches for prospects, scores them against the kind of company you described, and drops the matches into a campaign. You still choose when the mail goes out.',
  },
  {
    q: 'Can one campaign reach thousands of people?',
    a: 'Yes. A campaign sends one email to many recipients in a single run — a handful, fifty, or five thousand.',
  },
  {
    q: 'Can I read the draft before it sends?',
    a: 'Yes. Writing, choosing a mailbox, and launching stay as separate steps. Nothing leaves because the agent finished a sentence.',
  },
  {
    q: 'How do groups work?',
    a: 'Recipients live in your library. A group is a segment of that library — a role, an import, a hand-picked set — and any campaign can use it.',
  },
  {
    q: 'Which mailbox does the mail come from?',
    a: 'You connect an SMTP account, test it, and pick that account when the campaign is ready to launch.',
  },
  {
    q: 'Are my contacts private?',
    a: 'Recipients and groups stay inside your Outreach Studio workspace. They are not mixed with anyone else’s list.',
  },
  {
    q: 'What does automation cover?',
    a: 'The loop you would otherwise do by hand: find leads, write the email, send the campaign, and queue the follow-up.',
  },
];
