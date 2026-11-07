import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion, useInView } from 'framer-motion';
import { EASE, FAQS, IMPACT, PLANS, QUOTES } from './content';
import { Counter, GlowLink } from './kit';

export function Stats() {
  const ref = useRef(null);
  const active = useInView(ref, { once: true, amount: 0.5 });

  return (
    <section className="os-stats" ref={ref} aria-label="Sample workspace, last 30 days">
      <div className="os-shell">
        <p className="os-kicker"><span>07</span>Sample workspace · 30 days</p>
        <div className="os-stats-grid">
          {IMPACT.map((item) => (
            <p key={item.label}>
              <Counter to={item.value} active={active} suffix={item.suffix || ''} />
              <span>{item.label}</span>
            </p>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Pricing({ startTo }) {
  const [yearly, setYearly] = useState(false);

  return (
    <section className="os-section" id="pricing">
      <div className="os-shell">
        <div className="os-head os-head-center">
          <p className="os-kicker"><span>08</span>Pricing</p>
          <h2>Pay for the volume you actually send.</h2>
          <p>Placeholder prices for the preview. The workspace is the same on every tier — the ceiling changes.</p>
        </div>
        <div className={`os-switch ${yearly ? 'is-yearly' : ''}`} role="group" aria-label="Billing period">
          <i aria-hidden="true" />
          <button type="button" aria-pressed={!yearly} onClick={() => setYearly(false)}>Monthly</button>
          <button type="button" aria-pressed={yearly} onClick={() => setYearly(true)}>Yearly</button>
        </div>
        <p className="os-save">{yearly ? 'Yearly shows the monthly equivalent, 20% off.' : 'Yearly billing saves 20%.'}</p>
        <div className="os-plans">
          {PLANS.map((plan) => {
            const price = yearly ? Math.round(plan.monthly * 0.8) : plan.monthly;
            return (
              <article key={plan.name} className={`os-plan ${plan.popular ? 'is-popular' : ''}`}>
                {plan.popular ? <span className="os-popular">Most teams</span> : null}
                <h3>{plan.name}</h3>
                <p>{plan.blurb}</p>
                <p className="os-price">
                  <AnimatePresence mode="wait">
                    <motion.strong
                      key={price}
                      initial={{ y: 10, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      exit={{ y: -10, opacity: 0 }}
                      transition={{ duration: 0.28, ease: EASE }}
                    >
                      ${price}
                    </motion.strong>
                  </AnimatePresence>
                  <span>/mo</span>
                </p>
                <ul>
                  {plan.points.map((point) => <li key={point}>{point}</li>)}
                </ul>
                <GlowLink to={startTo}>{plan.popular ? 'Get started' : 'Choose ' + plan.name}</GlowLink>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export function Voices() {
  return (
    <section className="os-section" id="stories" aria-label="Sample stories">
      <div className="os-shell">
        <div className="os-head">
          <p className="os-kicker"><span>09</span>From the desk</p>
          <h2>Operators who were tired of the paste.</h2>
          <p>Short notes from people who used to run outbound by hand.</p>
        </div>
        <div className="os-voices">
          {QUOTES.map((item) => (
            <figure className="os-voice" key={item.name}>
              <blockquote>“{item.quote}”</blockquote>
              <figcaption>
                <strong>{item.name}</strong>
                <span>{item.role}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Faq() {
  const [open, setOpen] = useState(0);

  return (
    <section className="os-section" id="faq">
      <div className="os-shell os-faq-grid">
        <div className="os-head">
          <p className="os-kicker"><span>10</span>FAQ</p>
          <h2>Before you connect a mailbox.</h2>
        </div>
        <div className="os-faq">
          {FAQS.map((item, index) => {
            const isOpen = open === index;
            return (
              <div key={item.q} className={`os-faq-item ${isOpen ? 'is-open' : ''}`}>
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? -1 : index)}
                >
                  <span>{item.q}</span>
                  <i aria-hidden="true" />
                </button>
                <motion.div
                  initial={false}
                  animate={{ height: isOpen ? 'auto' : 0, opacity: isOpen ? 1 : 0 }}
                  transition={{ duration: 0.35, ease: EASE }}
                >
                  <p>{item.a}</p>
                </motion.div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export function Contact() {
  const [form, setForm] = useState({ name: '', email: '', message: '' });
  const [sent, setSent] = useState(false);

  const update = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  };

  const submit = (event) => {
    event.preventDefault();
    const subject = encodeURIComponent(`Outreach Studio — ${form.name || 'hello'}`);
    const body = encodeURIComponent(`${form.message}\n\n—\n${form.name}\n${form.email}`);
    window.location.href = `mailto:hello@outreachstudio.app?subject=${subject}&body=${body}`;
    setSent(true);
  };

  return (
    <section className="os-section" id="contact">
      <div className="os-shell os-contact">
        <div className="os-head">
          <p className="os-kicker"><span>11</span>Contact</p>
          <h2>Tell us what you’re trying to send.</h2>
          <p>A list, a mailbox question, or a campaign that should have gone out last week. Write it here and it lands with us.</p>
          <a className="os-contact-mail" href="mailto:hello@outreachstudio.app">hello@outreachstudio.app</a>
        </div>
        <form className="os-contact-form" onSubmit={submit}>
          <label>
            <span>Name</span>
            <input name="name" value={form.name} onChange={update} autoComplete="name" required />
          </label>
          <label>
            <span>Email</span>
            <input name="email" type="email" value={form.email} onChange={update} autoComplete="email" required />
          </label>
          <label>
            <span>Message</span>
            <textarea name="message" rows={5} value={form.message} onChange={update} required />
          </label>
          <button className="os-btn os-btn-primary" type="submit">Send message</button>
          <p className="os-contact-note" role="status">
            {sent ? 'Your mail app should open with the note ready.' : 'We read every note. No newsletter attached.'}
          </p>
        </form>
      </div>
    </section>
  );
}

export function Footer({ startTo, loginTo }) {
  return (
    <footer className="os-footer">
      <div className="os-footer-line" aria-hidden="true" />
      <div className="os-shell os-footer-grid">
        <div>
          <strong>Outreach Studio</strong>
          <p>The desk for cold email: leads, templates, campaigns, and the follow-up.</p>
        </div>
        <div>
          <span>Product</span>
          <a href="#features">Features</a>
          <a href="#how">How it works</a>
          <a href="#pricing">Pricing</a>
          <a href="#faq">FAQ</a>
        </div>
        <div>
          <span>Workspace</span>
          <a href="#demo">Campaign demo</a>
          <a href="#contact">Contact</a>
          <a href="mailto:hello@outreachstudio.app">hello@outreachstudio.app</a>
        </div>
        <div>
          <span>Account</span>
          <Link to={loginTo}>Login</Link>
          <Link to={startTo}>Get started</Link>
        </div>
      </div>
      <div className="os-shell os-footer-base">
        <small>© {new Date().getFullYear()} Outreach Studio</small>
        <small>Sample stories and prices on this page are placeholders.</small>
      </div>
    </footer>
  );
}
