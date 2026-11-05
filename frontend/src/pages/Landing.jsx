import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  ArrowRight,
  ArrowUp,
  BarChart3,
  Bot,
  FileScan,
  Layers,
  Mail,
  Menu,
  Plus,
  Send,
  Star,
  Moon,
  Sun,
  UserRoundPlus,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Brand } from '../components/Brand';
import '../styles/landing.css';

const NAV = [
  ['Home', '#top'],
  ['Features', '#features'],
  ['How it works', '#how-it-works'],
  ['Product', '#product'],
  ['FAQ', '#faq'],
  ['Contact', '#contact'],
];

const CONTACT_EMAIL = 'hello@outreachstudio.app';
const LANDING_THEME_KEY = 'mf_landing_theme';

const FEATURES = [
  {
    icon: Bot,
    tag: 'Compose',
    tone: 'compose',
    title: 'Write with AI',
    body: 'Spin up campaign copy in Compose, then polish the draft before anything leaves your inbox.',
  },
  {
    icon: Users,
    tag: 'Audience',
    tone: 'audience',
    title: 'Recipients library',
    body: 'A private contact shelf for your account — search fast, import from supported documents.',
  },
  {
    icon: UserRoundPlus,
    tag: 'Audience',
    tone: 'audience',
    title: 'Recipient groups',
    body: 'Build broadcast lists once, then drop them into any new campaign without rebuilding.',
  },
  {
    icon: Mail,
    tag: 'Delivery',
    tone: 'delivery',
    title: 'Campaigns',
    body: 'Draft, attach, send, duplicate — and watch delivery status without leaving the workspace.',
  },
  {
    icon: FileScan,
    tag: 'Library',
    tone: 'library',
    title: 'Attachments',
    body: 'Keep outreach files in one place and reuse them across campaigns when you need them.',
  },
  {
    icon: Layers,
    tag: 'Library',
    tone: 'library',
    title: 'Templates',
    body: 'Subject and body starters that cut blank-page time every time you open Compose.',
  },
  {
    icon: Activity,
    tag: 'Insights',
    tone: 'insights',
    title: 'Email activity',
    body: 'Message-level delivery history so you can see what landed after a campaign goes out.',
  },
  {
    icon: BarChart3,
    tag: 'Insights',
    tone: 'insights',
    title: 'Analytics & SMTP',
    body: 'Overview metrics plus tested SMTP accounts in Settings — send with confidence.',
  },
];

const STEPS = [
  {
    num: '01',
    title: 'Import your contacts',
    body: 'Add recipients or import from supported documents into your private library.',
    tip: 'Private to your workspace',
  },
  {
    num: '02',
    title: 'Create your campaign',
    body: 'Select groups, write with AI, attach documents, and choose a tested SMTP account.',
    tip: 'Human review before send',
  },
  {
    num: '03',
    title: 'Launch & track',
    body: 'Send from Campaigns, then follow progress in detail, Email activity, and Analytics.',
    tip: 'Live status updates',
  },
];

const PRODUCT_POINTS = [
  ['Compose + AI', 'Draft, personalize, review'],
  ['Recipients & groups', 'Private audience library'],
  ['Campaigns & activity', 'Send and follow every message'],
  ['Files & templates', 'Reuse what already works'],
  ['Analytics', 'See what landed'],
  ['SMTP settings', 'Tested senders ready'],
];

function FeatureCard({ item, index }) {
  const ref = useRef(null);
  const Icon = item.icon;

  const onMove = (event) => {
    const node = ref.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    const tiltX = (0.5 - y) * 14;
    const tiltY = (x - 0.5) * 16;
    const shiftX = (x - 0.5) * 10;
    const shiftY = (y - 0.5) * 10;
    node.style.transform = `translate3d(${shiftX}px, ${shiftY - 8}px, 0) rotateX(${tiltX}deg) rotateY(${tiltY}deg)`;
  };

  const onLeave = () => {
    const node = ref.current;
    if (!node) return;
    node.style.transform = '';
  };

  return (
    <article
      ref={ref}
      className={`lf-feature lf-feature-shift-${(index % 4) + 1}`}
      data-tone={item.tone}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
    >
      <div className="lf-feature-inner">
        <div className="lf-feature-face lf-feature-front">
          <div className="lf-feature-icon">
            <Icon size={18} />
          </div>
          <h3>{item.title}</h3>
          <span className="lf-feature-flip-hint">View details</span>
        </div>
        <div className="lf-feature-face lf-feature-back">
          <span className="lf-feature-tag">{item.tag}</span>
          <h3>{item.title}</h3>
          <p>{item.body}</p>
        </div>
      </div>
    </article>
  );
}

const FAQS = [
  {
    q: 'Is Write with AI available in Compose?',
    a: 'Yes. Use Write with AI inside Compose to draft subject and body copy, then edit before you send.',
  },
  {
    q: 'Are recipients private to my workspace?',
    a: 'Yes. Recipients and groups stay private to your Outreach Studio organization.',
  },
  {
    q: 'Can I reuse attachments and templates?',
    a: 'Yes. Upload files in Attachments and save message templates for later campaigns.',
  },
  {
    q: 'Can I review a campaign before it sends?',
    a: 'Yes. Every campaign keeps drafting, review, SMTP selection, and sending as explicit steps in the workspace.',
  },
  {
    q: 'Does Outreach Studio support tested SMTP accounts?',
    a: 'Yes. Add an SMTP account in Settings, test the connection, and select it when you are ready to send.',
  },
  {
    q: 'Can I track delivery after sending?',
    a: 'Yes. Campaign status, Email activity, and Analytics show message-level progress after a campaign goes out.',
  },
];

const TRUST = ['Northstar', 'Vertex Labs', 'Beacon', 'Orbit Co', 'Pulse'];

export default function Landing() {
  const { authenticated } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [showTop, setShowTop] = useState(false);
  const [contact, setContact] = useState({ name: '', email: '', message: '' });
  const [contactSent, setContactSent] = useState(false);
  const [openFaq, setOpenFaq] = useState(null);
  const [landingTheme, setLandingTheme] = useState(() => {
    try {
      return localStorage.getItem(LANDING_THEME_KEY) === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  });

  const startTo = useMemo(
    () => (authenticated ? '/overview' : '/login?register=1'),
    [authenticated],
  );

  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > 640);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const closeMenu = () => setMenuOpen(false);

  const toggleLandingTheme = () => {
    setLandingTheme((current) => {
      const next = current === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(LANDING_THEME_KEY, next); } catch { /* ignore */ }
      return next;
    });
  };

  const submitContact = (event) => {
    event.preventDefault();
    const subject = encodeURIComponent(`Outreach Studio — message from ${contact.name || 'visitor'}`);
    const body = encodeURIComponent(
      `${contact.message}\n\n—\n${contact.name}\n${contact.email}`,
    );
    window.location.href = `mailto:${CONTACT_EMAIL}?subject=${subject}&body=${body}`;
    setContactSent(true);
  };

  return (
    <div className="landing" id="top" data-theme={landingTheme}>
      <div className="lf-glow" aria-hidden="true">
        <span className="lf-glow-blob lf-glow-a" />
        <span className="lf-glow-blob lf-glow-b" />
      </div>

      <div className="lf-shell">
        <header className="lf-glass-nav-wrap">
          <div className="lf-glass-nav">
            <a href="#top" className="lf-glass-brand" onClick={closeMenu} aria-label="Outreach Studio home">
              <Brand />
            </a>
            <nav className="lf-glass-links" aria-label="Primary">
              {NAV.map(([label, href]) => (
                <a key={href} href={href}>
                  {label}
                </a>
              ))}
            </nav>
            <div className="lf-glass-actions">
              <button
                type="button"
                className="lf-theme-toggle"
                onClick={toggleLandingTheme}
                aria-label={`Switch to ${landingTheme === 'dark' ? 'light' : 'dark'} mode`}
                title={`Switch to ${landingTheme === 'dark' ? 'light' : 'dark'} mode`}
              >
                {landingTheme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
              </button>
              <Link className="lf-glass-signup" to={authenticated ? '/overview' : '/login?register=1'}>
                {authenticated ? 'Open app' : 'Sign Up'}
                <span className="lf-glass-signup-icon" aria-hidden="true">
                  <ArrowRight size={14} />
                </span>
              </Link>
              <button
                type="button"
                className="lf-menu"
                aria-label={menuOpen ? 'Close menu' : 'Open menu'}
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((open) => !open)}
              >
                {menuOpen ? <X size={18} /> : <Menu size={18} />}
              </button>
            </div>
          </div>
          <div className={`lf-drawer${menuOpen ? ' open' : ''}`}>
            {NAV.map(([label, href]) => (
              <a key={href} href={href} onClick={closeMenu}>
                {label}
              </a>
            ))}
            <Link className="lf-glass-signup" to={startTo} onClick={closeMenu}>
              {authenticated ? 'Open workspace' : 'Sign Up'}
              <span className="lf-glass-signup-icon" aria-hidden="true">
                <ArrowRight size={14} />
              </span>
            </Link>
          </div>
        </header>

        <main>
          <section className="lf-hero">
            <div className="lf-hero-grid">
              <div className="lf-hero-copy">
                <div className="lf-rating" aria-label="Rated 4.9 out of 5 by 2700 or more customers">
                  <span className="lf-stars" aria-hidden="true">
                    {Array.from({ length: 5 }).map((_, index) => (
                      <Star key={index} size={14} fill="#f59e0b" stroke="#f59e0b" />
                    ))}
                  </span>
                  <span>Rated 4.9/5 by 2700+ customers</span>
                </div>
                <h1 className="lf-hero-title">Work smarter, achieve faster</h1>
                <p className="lf-hero-sub">
                  Effortlessly manage your outreach, collaborate with your team, and achieve your goals with our
                  intuitive campaign workspace.
                </p>
                <Link className="lf-cta-primary" to={startTo}>
                  Get Started Now
                  <span className="lf-cta-orb" aria-hidden="true">
                    <ArrowRight size={16} />
                  </span>
                </Link>
              </div>

              <div className="lf-orb-wrap" aria-hidden="true">
                <div className="lf-mailworld">
                  <div className="lf-mw-aura lf-mw-aura-a" />
                  <div className="lf-mw-aura lf-mw-aura-b" />
                  <div className="lf-mw-grid" />

                  <svg className="lf-mw-routes" viewBox="0 0 520 520" fill="none">
                    <defs>
                      <linearGradient id="lfRoute" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor="#4f46e5" stopOpacity="0" />
                        <stop offset="45%" stopColor="#6488f6" stopOpacity="0.75" />
                        <stop offset="100%" stopColor="#93c5fd" stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    <path className="lf-mw-route lf-mw-route-1" d="M260 260 C180 210, 120 140, 88 96" />
                    <path className="lf-mw-route lf-mw-route-2" d="M260 260 C330 200, 390 150, 430 108" />
                    <path className="lf-mw-route lf-mw-route-3" d="M260 260 C200 320, 140 380, 96 424" />
                    <path className="lf-mw-route lf-mw-route-4" d="M260 260 C340 310, 400 370, 438 418" />
                    <path className="lf-mw-route lf-mw-route-5" d="M260 260 C310 250, 380 255, 452 248" />
                    <path className="lf-mw-route lf-mw-route-6" d="M260 260 C210 255, 140 248, 72 236" />
                  </svg>

                  <div className="lf-mw-core">
                    <div className="lf-mw-core-shine" />
                    <div className="lf-mw-core-ring" />
                    <div className="lf-mw-inbox">
                      <span className="lf-mw-flap" />
                      <span className="lf-mw-body">
                        <i />
                        <i />
                        <i />
                      </span>
                    </div>
                    <p>Live outreach</p>
                  </div>

                  <div className="lf-mw-ship lf-mw-ship-1">
                    <div className="lf-mw-envelope">
                      <span className="lf-mw-e-flap" />
                      <span className="lf-mw-e-sheet" />
                      <span className="lf-mw-e-face" />
                    </div>
                  </div>
                  <div className="lf-mw-ship lf-mw-ship-2">
                    <div className="lf-mw-envelope lf-mw-envelope-sm">
                      <span className="lf-mw-e-flap" />
                      <span className="lf-mw-e-sheet" />
                      <span className="lf-mw-e-face" />
                    </div>
                  </div>
                  <div className="lf-mw-ship lf-mw-ship-3">
                    <div className="lf-mw-envelope">
                      <span className="lf-mw-e-flap" />
                      <span className="lf-mw-e-sheet" />
                      <span className="lf-mw-e-face" />
                    </div>
                  </div>
                  <div className="lf-mw-ship lf-mw-ship-4">
                    <div className="lf-mw-envelope lf-mw-envelope-sm">
                      <span className="lf-mw-e-flap" />
                      <span className="lf-mw-e-sheet" />
                      <span className="lf-mw-e-face" />
                    </div>
                  </div>
                  <div className="lf-mw-ship lf-mw-ship-5">
                    <div className="lf-mw-envelope">
                      <span className="lf-mw-e-flap" />
                      <span className="lf-mw-e-sheet" />
                      <span className="lf-mw-e-face" />
                    </div>
                  </div>
                  <div className="lf-mw-ship lf-mw-ship-6">
                    <div className="lf-mw-envelope lf-mw-envelope-sm">
                      <span className="lf-mw-e-flap" />
                      <span className="lf-mw-e-sheet" />
                      <span className="lf-mw-e-face" />
                    </div>
                  </div>

                  <div className="lf-mw-node lf-mw-node-1">
                    <b />
                    <span>Alex</span>
                  </div>
                  <div className="lf-mw-node lf-mw-node-2">
                    <b />
                    <span>Priya</span>
                  </div>
                  <div className="lf-mw-node lf-mw-node-3">
                    <b />
                    <span>Sam</span>
                  </div>
                  <div className="lf-mw-node lf-mw-node-4">
                    <b />
                    <span>Noah</span>
                  </div>
                  <div className="lf-mw-node lf-mw-node-5">
                    <b />
                    <span>Group</span>
                  </div>
                  <div className="lf-mw-node lf-mw-node-6">
                    <b />
                    <span>List</span>
                  </div>

                  <div className="lf-mw-toast lf-mw-toast-1">Delivered</div>
                  <div className="lf-mw-toast lf-mw-toast-2">Opened</div>
                  <div className="lf-mw-toast lf-mw-toast-3">Queued</div>

                  <span className="lf-mw-dust lf-mw-dust-1" />
                  <span className="lf-mw-dust lf-mw-dust-2" />
                  <span className="lf-mw-dust lf-mw-dust-3" />
                  <span className="lf-mw-dust lf-mw-dust-4" />
                  <span className="lf-mw-dust lf-mw-dust-5" />
                  <span className="lf-mw-dust lf-mw-dust-6" />
                  <span className="lf-mw-dust lf-mw-dust-7" />
                  <span className="lf-mw-dust lf-mw-dust-8" />
                </div>
              </div>
            </div>

            <div className="lf-trust">
              <p>Trusted by top-tier product companies</p>
              <div className="lf-trust-logos">
                {TRUST.map((name) => (
                  <svg key={name} className="lf-trust-logo" viewBox="0 0 120 28" role="img" aria-label={name}>
                    <text x="0" y="20" fill="currentColor" fontSize="14" fontFamily="Inter, sans-serif" fontWeight="650">
                      {name}
                    </text>
                  </svg>
                ))}
              </div>
            </div>
          </section>

          <section className="lf-section" id="features">
            <div className="lf-head lf-head-center">
              <p className="lf-kicker">Features</p>
              <h2>Everything you need for smarter email outreach</h2>
              <p>Modules you already use in Outreach Studio — sharper, clearer, ready to ship.</p>
            </div>
            <div className="lf-features">
              {FEATURES.map((item, index) => (
                <FeatureCard key={item.title} item={item} index={index} />
              ))}
            </div>
          </section>

          <section className="lf-section lf-section-band" id="how-it-works">
            <div className="lf-head lf-head-center">
              <p className="lf-kicker">How it works</p>
              <h2>Three steps from contacts to tracked delivery</h2>
              <p>From a private audience to send — with review and tracking built in.</p>
            </div>
            <div className="lf-steps">
              {STEPS.map((step, index) => (
                <article className="lf-step" key={step.num}>
                  <div className="lf-step-rail" aria-hidden="true">
                    <span className="lf-step-node">{step.num}</span>
                    {index < STEPS.length - 1 && <i className="lf-step-line" />}
                  </div>
                  <div className="lf-step-copy">
                    <h3>{step.title}</h3>
                    <p>{step.body}</p>
                    <small>{step.tip}</small>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="lf-section" id="product">
            <div className="lf-head lf-head-center">
              <p className="lf-kicker">Product</p>
              <h2>What you open after sign-in</h2>
              <p>One workspace for compose, audience, campaigns, files, and SMTP — without hopping tools.</p>
            </div>
            <div className="lf-product-card">
              <div className="lf-product-copy">
                <span className="lf-product-badge">Workspace</span>
                <h3>Your outreach desk, already wired</h3>
                <p>
                  Write with AI, pull private recipients and groups, attach docs, pick a tested SMTP account,
                  then send with human review and live status.
                </p>
                <div className="lf-product-chips">
                  {['Compose', 'Recipients', 'Campaigns', 'Attachments', 'SMTP'].map((label) => (
                    <span key={label}>{label}</span>
                  ))}
                </div>
                <Link className="lf-cta-primary lf-cta-compact" to={startTo}>
                  {authenticated ? 'Open workspace' : 'Create account'}
                  <span className="lf-cta-orb" aria-hidden="true">
                    <ArrowRight size={15} />
                  </span>
                </Link>
              </div>
              <div className="lf-product-panel" aria-hidden="true">
                <div className="lf-product-panel-top">
                  <i />
                  <i />
                  <i />
                  <span>Outreach Studio</span>
                </div>
                <ul className="lf-product-grid">
                  {PRODUCT_POINTS.map(([title, meta]) => (
                    <li key={title}>
                      <strong>{title}</strong>
                      <small>{meta}</small>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>

          <section className="lf-section" id="faq">
            <div className="lf-faq-layout">
              <div className="lf-head">
                <p className="lf-kicker">FAQ</p>
                <h2>Clear answers before you hit send.</h2>
                <p>Everything important, without the sales-talk fog.</p>
                <div className="lf-faq-spotlight">
                  <span className="lf-faq-spotlight-orb">?</span>
                  <div><strong>Still have a question?</strong><small>Our team is one message away.</small></div>
                </div>
              </div>
              <div className="lf-faq">
                {FAQS.map((item, index) => (
                  <details
                    key={item.q}
                    open={openFaq === index}
                    onToggle={(event) => {
                      if (event.currentTarget.open) setOpenFaq(index);
                      else if (openFaq === index) setOpenFaq(null);
                    }}
                  >
                    <summary>
                      <span className="lf-faq-number">0{index + 1}</span>
                      <span className="lf-faq-question">{item.q}</span>
                      <Plus size={18} />
                    </summary>
                    <p>{item.a}</p>
                  </details>
                ))}
              </div>
            </div>
          </section>

        </main>

        <footer className="lf-contact" id="contact">
          <div className="lf-contact-card">
            <div className="lf-contact-copy">
              <p className="lf-kicker">Contact</p>
              <h2>Talk to us</h2>
              <p>Questions about outreach, SMTP, or getting your workspace set up — send a note.</p>
              <Link className="lf-cta-primary lf-cta-compact" to={startTo}>
                {authenticated ? 'Open workspace' : 'Get Started Now'}
                <span className="lf-cta-orb" aria-hidden="true">
                  <ArrowRight size={15} />
                </span>
              </Link>
            </div>

            <form className="lf-contact-form" onSubmit={submitContact}>
              <label>
                <span>Name</span>
                <input
                  type="text"
                  name="name"
                  autoComplete="name"
                  placeholder="Your name"
                  value={contact.name}
                  onChange={(event) => setContact((current) => ({ ...current, name: event.target.value }))}
                  required
                />
              </label>
              <label>
                <span>Email</span>
                <input
                  type="email"
                  name="email"
                  autoComplete="email"
                  placeholder="you@company.com"
                  value={contact.email}
                  onChange={(event) => setContact((current) => ({ ...current, email: event.target.value }))}
                  required
                />
              </label>
              <label>
                <span>Message</span>
                <textarea
                  name="message"
                  rows={4}
                  placeholder="How can we help?"
                  value={contact.message}
                  onChange={(event) => setContact((current) => ({ ...current, message: event.target.value }))}
                  required
                />
              </label>
              <button className="lf-cta-primary lf-cta-compact" type="submit">
                {contactSent ? 'Opening mail…' : 'Send message'}
                <span className="lf-cta-orb" aria-hidden="true">
                  <Send size={14} />
                </span>
              </button>
            </form>
          </div>
          <div className="lf-contact-bar">
            <Brand />
            <span>© {new Date().getFullYear()} Outreach Studio</span>
          </div>
        </footer>
      </div>

      {showTop && (
        <button
          type="button"
          className="lf-top"
          aria-label="Back to top"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        >
          <ArrowUp size={17} />
        </button>
      )}
    </div>
  );
}
