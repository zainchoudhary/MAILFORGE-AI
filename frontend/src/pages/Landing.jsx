import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  ArrowRight,
  ArrowUp,
  BarChart3,
  BookOpen,
  Bot,
  FileScan,
  Layers,
  LayoutDashboard,
  Mail,
  Menu,
  Plug,
  Plus,
  Settings,
  ShieldCheck,
  Sparkles,
  UserRoundPlus,
  Users,
  X,
  Zap,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Brand } from '../components/Brand';
import '../styles/landing.css';

const NAV = [
  ['Home', '#top'],
  ['Features', '#features'],
  ['How It Works', '#how-it-works'],
  ['Workspace', '#workspace'],
  ['FAQ', '#faq'],
];

const FEATURES = [
  {
    icon: Bot,
    title: 'Write with AI',
    body: 'Draft campaign email content in Compose with AI, then review before you send.',
  },
  {
    icon: Users,
    title: 'Recipients library',
    body: 'Keep contacts private to your account, search them, and import from supported documents.',
  },
  {
    icon: UserRoundPlus,
    title: 'Recipient groups',
    body: 'Save broadcast lists once and reuse them when composing campaigns.',
  },
  {
    icon: Mail,
    title: 'Campaigns',
    body: 'Create drafts, attach files, send, duplicate campaigns, and follow delivery status.',
  },
  {
    icon: FileScan,
    title: 'Attachments',
    body: 'Upload and manage documents used across campaigns and outreach workflows.',
  },
  {
    icon: Layers,
    title: 'Templates',
    body: 'Reuse subject and body templates so every campaign starts faster.',
  },
  {
    icon: Activity,
    title: 'Email activity',
    body: 'Inspect message-level delivery history after campaigns go out.',
  },
  {
    icon: BarChart3,
    title: 'Analytics & SMTP',
    body: 'Review overview metrics and send through tested SMTP accounts in Settings.',
  },
];

const STEPS = [
  {
    num: '01',
    title: 'Import your contacts',
    body: 'Add recipients or import from supported documents into your private library.',
  },
  {
    num: '02',
    title: 'Create your campaign',
    body: 'Select groups, write with AI, attach documents, and choose a tested SMTP account.',
  },
  {
    num: '03',
    title: 'Launch & track',
    body: 'Send from Campaigns, then follow progress in detail, Email activity, and Analytics.',
  },
];

const SHOW = [
  {
    title: 'Campaigns',
    body: 'Draft, send, duplicate, and track statuses that already exist in your workspace.',
    rows: [
      ['Draft', 'Editable'],
      ['Send campaign', 'Approve & deliver'],
      ['Duplicate', 'New draft copy'],
    ],
  },
  {
    title: 'Compose + AI',
    body: 'Write subjects and bodies with Write with AI, then keep final approval in your hands.',
    rows: [
      ['Write with AI', 'In Compose'],
      ['Templates', 'Reusable'],
      ['Attachments', 'Linked docs'],
    ],
  },
  {
    title: 'Audience',
    body: 'Manage recipients and groups without leaving Outreach Studio.',
    rows: [
      ['Recipients', 'Private library'],
      ['Recipient groups', 'Saved lists'],
      ['Import', 'Document-based'],
    ],
  },
  {
    title: 'Operations',
    body: 'Use Email activity, Analytics, SMTP settings, and Audit logs for accountable delivery.',
    rows: [
      ['Email activity', 'Message timeline'],
      ['Analytics', 'Overview metrics'],
      ['SMTP settings', 'Tested accounts'],
    ],
  },
];

const MODULES = [
  ['Overview', 'Workspace home and live summary', LayoutDashboard],
  ['AI Agent Studio', 'Agent-assisted outreach tools', Bot],
  ['Recipients', 'Private contact library & import', Users],
  ['Recipient groups', 'Saved broadcast lists', UserRoundPlus],
  ['Campaigns', 'Draft, send, duplicate, track', Mail],
  ['Email activity', 'Per-message delivery history', Activity],
  ['Attachments', 'Document storage for campaigns', FileScan],
  ['Templates', 'Reusable email content', Layers],
  ['Analytics', 'Campaign and delivery metrics', BarChart3],
  ['Automation', 'Workflow automation tools', Zap],
  ['SMTP settings', 'Tested sending accounts', Plug],
  ['Integrations', 'Connected services', BookOpen],
  ['Audit logs', 'Accountable workspace history', ShieldCheck],
  ['Settings', 'Workspace preferences', Settings],
];

const FAQS = [
  {
    q: 'What is Outreach Studio?',
    a: 'Outreach Studio is the MAILFORGE AI workspace for recipients, campaigns, attachments, Write with AI, SMTP sending, and delivery tracking.',
  },
  {
    q: 'How does Write with AI work?',
    a: 'In Compose you can generate email content with AI, then edit and approve it before the campaign is sent.',
  },
  {
    q: 'Can I import recipients from documents?',
    a: 'Yes. Recipients can be imported from supported documents into your private recipient library.',
  },
  {
    q: 'Which modules exist in the app?',
    a: 'Overview, AI Agent Studio, Recipients, Recipient groups, Campaigns, Email activity, Attachments, Templates, Analytics, Automation, SMTP settings, Integrations, Audit logs, and Settings.',
  },
  {
    q: 'How do I track delivery?',
    a: 'Use Campaign detail for send progress, Email activity for message history, and Analytics for overview metrics.',
  },
  {
    q: 'Do I need SMTP configured?',
    a: 'Yes. Campaigns send through a tested SMTP account configured in SMTP settings.',
  },
];

export default function Landing() {
  const { authenticated } = useAuth();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showTop, setShowTop] = useState(false);

  const startTo = useMemo(
    () => (authenticated ? '/overview' : '/login?register=1'),
    [authenticated],
  );

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 10);
      setShowTop(window.scrollY > 640);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const closeMenu = () => setMenuOpen(false);

  return (
    <div className="landing" id="top">
      <header className={`lf-nav${scrolled ? ' on' : ''}`}>
        <div className="lf-wrap lf-nav-row">
          <a href="#top" onClick={closeMenu} aria-label="Outreach Studio home">
            <Brand />
          </a>
          <nav className="lf-links" aria-label="Primary">
            {NAV.map(([label, href]) => (
              <a key={href} href={href}>
                {label}
              </a>
            ))}
          </nav>
          <div className="lf-actions">
            <Link className="lf-btn lf-btn-secondary" to="/login">
              Sign In
            </Link>
            <Link className="lf-btn lf-btn-primary" to={startTo}>
              {authenticated ? 'Open workspace' : 'Get Started'}
              <ArrowRight size={15} />
            </Link>
          </div>
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
        <div className={`lf-wrap lf-drawer${menuOpen ? ' open' : ''}`}>
          {NAV.map(([label, href]) => (
            <a key={href} href={href} onClick={closeMenu}>
              {label}
            </a>
          ))}
          <Link className="lf-btn lf-btn-secondary" to="/login" onClick={closeMenu}>
            Sign In
          </Link>
          <Link className="lf-btn lf-btn-primary" to={startTo} onClick={closeMenu}>
            {authenticated ? 'Open workspace' : 'Get Started'}
          </Link>
        </div>
      </header>

      <main>
        <section className="lf-hero">
          <div className="lf-wrap lf-hero-grid">
            <div>
              <div className="lf-kicker">
                <Sparkles size={13} /> Outreach, made intentional
              </div>
              <h1 className="lf-title">
                Transform Your Email Outreach with <em>AI-Powered</em> Automation.
              </h1>
              <p className="lf-lead">
                Create smarter email campaigns, manage recipients, automate outreach, and scale your communication —
                all from one intelligent platform.
              </p>
              <div className="lf-hero-cta">
                <Link className="lf-btn lf-btn-primary" to={startTo}>
                  {authenticated ? 'Open workspace' : 'Get Started Free'}
                  <ArrowRight size={15} />
                </Link>
                <a className="lf-btn lf-btn-ghost" href="#features">
                  Explore Features
                </a>
              </div>
              <div className="lf-hero-points">
                <span>
                  <ShieldCheck size={14} /> Human-approved delivery
                </span>
                <span>
                  <Mail size={14} /> Campaigns · Recipients · SMTP
                </span>
              </div>
            </div>

            <div className="lf-stage" aria-hidden="true">
              <div className="lf-stage-top">
                <div className="lf-stage-dots">
                  <i />
                  <i />
                  <i />
                </div>
                <span>Workspace preview</span>
              </div>
              <div className="lf-stage-metrics">
                <article>
                  <span>Campaigns</span>
                  <strong>Live</strong>
                </article>
                <article>
                  <span>Recipients</span>
                  <strong>Private</strong>
                </article>
                <article>
                  <span>SMTP</span>
                  <strong>Tested</strong>
                </article>
              </div>
              <div className="lf-stage-body">
                <div className="lf-pane">
                  <h4>Recent campaigns</h4>
                  <div className="lf-row">
                    <span>Product launch</span>
                    <b>Sending</b>
                  </div>
                  <div className="lf-row">
                    <span>Hiring follow-up</span>
                    <b>Draft</b>
                  </div>
                  <div className="lf-row">
                    <span>Partner update</span>
                    <span className="lf-pill">Completed</span>
                  </div>
                </div>
                <div className="lf-pane">
                  <h4>Compose</h4>
                  <div className="lf-row">
                    <span>Write with AI</span>
                    <b>Ready</b>
                  </div>
                  <div className="lf-row">
                    <span>Attachments</span>
                    <b>Linked</b>
                  </div>
                  <div className="lf-row">
                    <span>Recipient group</span>
                    <b>Selected</b>
                  </div>
                </div>
              </div>
              <div className="lf-stage-float">
                <div className="lf-feature-icon" style={{ width: 34, height: 34, borderRadius: 10 }}>
                  <UserRoundPlus size={15} />
                </div>
                <div>
                  <strong>Recipient group ready</strong>
                  <small>Reuse saved lists in Compose</small>
                </div>
              </div>
            </div>
          </div>
        </section>

        <div className="lf-wrap">
          <div className="lf-stats" aria-label="Product highlights">
            <article className="lf-stat">
              <strong>Compose</strong>
              <span>Write with AI</span>
              <small>In-app drafting with review</small>
            </article>
            <article className="lf-stat">
              <strong>Audience</strong>
              <span>Recipients & groups</span>
              <small>Private to your workspace</small>
            </article>
            <article className="lf-stat">
              <strong>Delivery</strong>
              <span>Campaign tracking</span>
              <small>Status + email activity</small>
            </article>
            <article className="lf-stat">
              <strong>SMTP</strong>
              <span>Tested accounts</span>
              <small>Configured before send</small>
            </article>
          </div>
        </div>

        <section className="lf-section soft" id="features">
          <div className="lf-wrap">
            <div className="lf-head">
              <div className="lf-kicker">Features</div>
              <h2 className="lf-title">Everything You Need for Smarter Email Outreach</h2>
              <p className="lf-lead">Only modules and actions that already exist in Outreach Studio.</p>
            </div>
            <div className="lf-features">
              {FEATURES.map((item) => {
                const Icon = item.icon;
                return (
                  <article className="lf-feature" key={item.title}>
                    <div className="lf-feature-icon">
                      <Icon size={18} />
                    </div>
                    <div>
                      <h3>{item.title}</h3>
                      <p>{item.body}</p>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section className="lf-section dark" id="how-it-works">
          <div className="lf-wrap">
            <div className="lf-head">
              <div className="lf-kicker">How it works</div>
              <h2 className="lf-title">Three steps from contacts to tracked delivery</h2>
            </div>
            <div className="lf-steps">
              {STEPS.map((step) => (
                <article className="lf-step" key={step.num}>
                  <div className="num">{step.num}</div>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="lf-section sky" id="product">
          <div className="lf-wrap">
            <div className="lf-head">
              <div className="lf-kicker">Product</div>
              <h2 className="lf-title">What you open after sign-in</h2>
              <p className="lf-lead">Illustrative previews of real modules — not live screenshots.</p>
            </div>
            <div className="lf-show">
              {SHOW.map((item) => (
                <article className="lf-show-card" key={item.title}>
                  <div className="lf-show-copy">
                    <div className="lf-kicker">Module</div>
                    <h3>{item.title}</h3>
                    <p>{item.body}</p>
                  </div>
                  <div className="lf-mini" aria-hidden="true">
                    <div className="label">{item.title}</div>
                    {item.rows.map(([label, value]) => (
                      <div className="lf-row" key={label}>
                        <span>{label}</span>
                        <b>{value}</b>
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="lf-section soft" id="workspace">
          <div className="lf-wrap">
            <div className="lf-head">
              <div className="lf-kicker">Workspace map</div>
              <h2 className="lf-title">Exact sidebar destinations</h2>
              <p className="lf-lead">If it is not listed here, we do not market it on this page.</p>
            </div>
            <div className="lf-modules">
              {MODULES.map(([title, body, Icon]) => (
                <article className="lf-module" key={title}>
                  <Icon size={18} />
                  <h3>{title}</h3>
                  <p>{body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="lf-section soft" id="faq">
          <div className="lf-wrap">
            <div className="lf-head">
              <div className="lf-kicker">FAQ</div>
              <h2 className="lf-title">Straight answers</h2>
            </div>
            <div className="lf-faq">
              {FAQS.map((item) => (
                <details key={item.q}>
                  <summary>
                    {item.q}
                    <Plus size={18} />
                  </summary>
                  <p>{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="lf-cta" id="contact">
          <div className="lf-wrap">
            <h2 className="lf-title">Ready to Make Every Email Count?</h2>
            <p className="lf-lead">
              Start building smarter campaigns and simplify your email outreach with MAILFORGE AI.
            </p>
            <div className="lf-hero-cta">
              <Link className="lf-btn lf-btn-light" to={startTo}>
                Get Started Today
                <ArrowRight size={15} />
              </Link>
              <a className="lf-btn lf-btn-ghost" href="#features">
                Explore Features
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="lf-foot">
        <div className="lf-wrap">
          <div className="lf-foot-grid">
            <div>
              <Brand />
              <p>
                Outreach Studio helps teams create, send, and track email outreach with Write with AI, recipients,
                campaigns, attachments, and SMTP delivery.
              </p>
            </div>
            <div>
              <h4>Product</h4>
              <ul>
                <li>
                  <a href="#features">Features</a>
                </li>
                <li>
                  <a href="#workspace">Workspace</a>
                </li>
                <li>
                  <Link to="/login">Sign In</Link>
                </li>
              </ul>
            </div>
            <div>
              <h4>In-app</h4>
              <ul>
                <li>
                  <a href="#product">Campaigns</a>
                </li>
                <li>
                  <a href="#product">Compose + AI</a>
                </li>
                <li>
                  <a href="#product">Recipients</a>
                </li>
                <li>
                  <a href="#workspace">SMTP & Analytics</a>
                </li>
              </ul>
            </div>
            <div>
              <h4>Resources</h4>
              <ul>
                <li>
                  <a href="#faq">FAQ</a>
                </li>
                <li>
                  <a href="#contact">Contact</a>
                </li>
                <li>
                  <span>Privacy Policy</span>
                </li>
                <li>
                  <span>Terms of Service</span>
                </li>
              </ul>
            </div>
          </div>
          <div className="lf-foot-bottom">
            <span>© {new Date().getFullYear()} Outreach Studio</span>
            <span>Privacy Policy · Terms of Service</span>
          </div>
        </div>
      </footer>

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
