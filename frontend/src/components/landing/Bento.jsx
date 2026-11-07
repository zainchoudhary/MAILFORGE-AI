import { useEffect, useRef, useState } from 'react';
import { motion, useInView, useReducedMotion } from 'framer-motion';
import { EASE, FEATURES } from './content';

function RecipientsVisual() {
  const people = [['AM', 'Amina'], ['JL', 'Jonah'], ['PR', 'Priya'], ['CK', 'Chris'], ['EV', 'Elena']];
  return (
    <ul className="os-people" aria-hidden="true">
      {people.map(([initials, name], index) => (
        <li key={name} style={{ '--i': index }}>
          <span>{initials}</span>
          {name}
        </li>
      ))}
    </ul>
  );
}

function GroupsVisual() {
  return (
    <div className="os-cluster" aria-hidden="true">
      <span style={{ '--i': 0 }}>Founders</span>
      <span style={{ '--i': 1 }}>Recruiters</span>
      <span style={{ '--i': 2 }}>Customers</span>
      <span style={{ '--i': 3 }}>Warm list</span>
    </div>
  );
}

function TemplatesVisual() {
  const reduced = useReducedMotion();
  const ref = useRef(null);
  const live = useInView(ref, { amount: 0.4 });
  const full = 'Hi Maya — saw the round you closed. Worth a note this week?';
  const [text, setText] = useState(reduced ? full : '');

  useEffect(() => {
    if (reduced) {
      setText(full);
      return undefined;
    }
    if (!live) return undefined;
    let cancelled = false;
    let timer = 0;
    const wait = (ms) => new Promise((resolve) => {
      timer = window.setTimeout(resolve, ms);
    });
    const run = async () => {
      while (!cancelled) {
        for (let count = 1; count <= full.length && !cancelled; count += 1) {
          setText(full.slice(0, count));
          await wait(28);
        }
        await wait(1400);
        if (!cancelled) setText('');
        await wait(280);
      }
    };
    run();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [full, live, reduced]);

  return (
    <div className="os-template" ref={ref} aria-hidden="true">
      <small>Template · First touch</small>
      <p>{text}<i /></p>
    </div>
  );
}

function CampaignsVisual() {
  return (
    <div className="os-fan" aria-hidden="true">
      <svg viewBox="0 0 520 180" role="img">
        <path className="os-draw" d="M70 90 C 180 90 190 28 360 28" />
        <path className="os-draw" d="M70 90 H 360" />
        <path className="os-draw" d="M70 90 C 180 90 190 152 360 152" />
        <circle cx="70" cy="90" r="18" />
        <circle cx="360" cy="28" r="7" />
        <circle cx="360" cy="90" r="7" />
        <circle cx="360" cy="152" r="7" />
      </svg>
      <span className="os-fan-mail">1 email</span>
      <span className="os-fan-count">5,000</span>
    </div>
  );
}

function AgentVisual() {
  const leads = [
    ['Harbor', '92'],
    ['Kite & Co', '88'],
    ['Fieldwork', '81'],
  ];
  return (
    <div className="os-radar-wrap" aria-hidden="true">
      <div className="os-radar"><i /></div>
      <ul>
        {leads.map(([name, score], index) => (
          <li key={name} style={{ '--i': index }}>
            <span>{name}</span>
            <b>{score}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AutomationVisual() {
  const nodes = ['Find', 'Write', 'Send', 'Follow up'];
  return (
    <div className="os-flow" aria-hidden="true">
      {nodes.map((node) => (
        <div className="os-node" key={node}>
          <i />
          <span>{node}</span>
        </div>
      ))}
      <b className="os-flow-dot" />
    </div>
  );
}

const VISUALS = {
  recipients: RecipientsVisual,
  groups: GroupsVisual,
  templates: TemplatesVisual,
  campaigns: CampaignsVisual,
  agent: AgentVisual,
  automation: AutomationVisual,
};

function FeatureCard({ feature, index }) {
  const ref = useRef(null);
  const live = useInView(ref, { amount: 0.28 });
  const Visual = VISUALS[feature.key];

  const move = (event) => {
    const bounds = ref.current?.getBoundingClientRect();
    if (!bounds) return;
    ref.current.style.setProperty('--mx', `${event.clientX - bounds.left}px`);
    ref.current.style.setProperty('--my', `${event.clientY - bounds.top}px`);
  };

  return (
    <motion.article
      ref={ref}
      className={`os-card ${feature.span} ${live ? 'is-live' : ''}`}
      onPointerMove={move}
      initial={{ opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.25 }}
      transition={{ duration: 0.65, delay: (index % 3) * 0.06, ease: EASE }}
    >
      <div className="os-card-visual">
        <Visual />
      </div>
      <div className="os-card-copy">
        <p className="os-kicker">{feature.kicker}</p>
        <h3>{feature.title}</h3>
        <p>{feature.body}</p>
      </div>
    </motion.article>
  );
}

export function Bento() {
  return (
    <section className="os-section" id="features">
      <div className="os-shell">
        <div className="os-head">
          <p className="os-kicker"><span>03</span>The desk</p>
          <h2>Everything between a name and a reply.</h2>
          <p>Six pieces of the job, in the order you actually do them.</p>
        </div>
        <div className="os-bento">
          {FEATURES.map((feature, index) => (
            <FeatureCard key={feature.key} feature={feature} index={index} />
          ))}
        </div>
      </div>
    </section>
  );
}
