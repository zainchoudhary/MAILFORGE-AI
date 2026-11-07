import { useEffect, useState } from 'react';
import { motion, useMotionTemplate, useReducedMotion, useSpring } from 'framer-motion';
import { Play } from 'lucide-react';
import { EASE, HERO_DRAFTS, HERO_PEOPLE } from './content';
import { GlowLink, useNarrow } from './kit';

function WordLine({ text, accent = false, delay = 0 }) {
  return (
    <span className={`os-line ${accent ? 'is-accent' : ''}`}>
      {text.split(' ').map((word, index) => (
        <span className="os-word" key={`${word}-${index}`}>
          <motion.span
            initial={{ y: '115%' }}
            animate={{ y: '0%' }}
            transition={{ duration: 0.75, delay: delay + index * 0.055, ease: EASE }}
          >
            {word}
          </motion.span>
        </span>
      ))}
    </span>
  );
}

export function Hero({ startTo }) {
  const reduced = useReducedMotion();
  const narrow = useNarrow(980);
  const [draft, setDraft] = useState(HERO_DRAFTS[0].slice(0, reduced ? undefined : 0));
  const [sent, setSent] = useState(reduced ? 14820 : 12840);
  const rotateX = useSpring(0, { stiffness: 120, damping: 18 });
  const rotateY = useSpring(0, { stiffness: 120, damping: 18 });
  const tilt = useMotionTemplate`perspective(1400px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;

  useEffect(() => {
    if (reduced) {
      setDraft(HERO_DRAFTS[0]);
      return undefined;
    }
    let cancelled = false;
    let timer = 0;
    const wait = (ms) => new Promise((resolve) => {
      timer = window.setTimeout(resolve, ms);
    });

    const run = async () => {
      let index = 0;
      while (!cancelled) {
        const text = HERO_DRAFTS[index % HERO_DRAFTS.length];
        for (let count = 1; count <= text.length && !cancelled; count += 1) {
          setDraft(text.slice(0, count));
          await wait(16);
        }
        await wait(1600);
        index += 1;
      }
    };
    run();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [reduced]);

  useEffect(() => {
    if (reduced) return undefined;
    const timer = window.setInterval(() => {
      setSent((value) => value + 13 + Math.floor(Math.random() * 18));
    }, 900);
    return () => window.clearInterval(timer);
  }, [reduced]);

  const onMove = (event) => {
    if (narrow || reduced) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const px = (event.clientX - bounds.left) / bounds.width - 0.5;
    const py = (event.clientY - bounds.top) / bounds.height - 0.5;
    rotateY.set(px * 10);
    rotateX.set(py * -8);
  };

  const opened = Math.round(sent * 0.41);
  const replied = Math.round(sent * 0.07);

  return (
    <section className="os-hero-section">
      <div className="os-shell os-hero">
        <div className="os-hero-copy">
          <p className="os-kicker"><span>01</span>Outreach, on one desk</p>
          <h1>
            <WordLine text="Find leads. Write emails." delay={0.12} />
            <WordLine text="Send at scale." delay={0.34} />
            <WordLine text="All on autopilot." accent delay={0.52} />
          </h1>
          <motion.p
            className="os-hero-sub"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.9, ease: EASE }}
          >
            Search the prospects, draft the note, and send the follow-up from the same workspace. You still launch every campaign.
          </motion.p>
          <motion.div
            className="os-hero-actions"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 1.02, ease: EASE }}
          >
            <GlowLink to={startTo}>Get started</GlowLink>
            <a className="os-btn os-btn-ghost" href="#demo">
              <Play size={14} aria-hidden="true" />
              Watch demo
            </a>
          </motion.div>
          <p className="os-hero-note">Your mailbox. Your list. Nothing sends until you say so.</p>
        </div>

        <div
          className="os-visual"
          onPointerMove={onMove}
          onPointerLeave={() => {
            rotateX.set(0);
            rotateY.set(0);
          }}
        >
          <div className="os-particles" aria-hidden="true">
            {Array.from({ length: 14 }, (_, index) => <i key={index} style={{ '--i': index }} />)}
          </div>
          <motion.div className="os-stage" style={narrow || reduced ? undefined : { transform: tilt }}>
            <article className="os-float os-float-a">
              <small>BD agent</small>
              <strong>128 leads scored</strong>
              <span>41 ready to review</span>
            </article>
            <article className="os-float os-float-b">
              <small>Follow-up</small>
              <strong>Day 3 queued</strong>
              <span>Leaves Thursday, 9:00</span>
            </article>
            <article className="os-window">
              <header>
                <i /><i /><i />
                <span>Campaigns · Series A founders</span>
              </header>
              <div className="os-window-grid">
                <div className="os-compose">
                  <p className="os-ai-pill"><span /> AI writing</p>
                  <p className="os-subject">Subject · A note after the round</p>
                  <p className="os-typed" aria-hidden="true">
                    {draft}
                    <i />
                  </p>
                </div>
                <div className="os-recipient-col">
                  <p>Recipients</p>
                  <ul>
                    {HERO_PEOPLE.map(([initials, name], index) => (
                      <li key={name} style={{ '--i': index }}>
                        <span>{initials}</span>
                        {name}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              <footer>
                <div>
                  <strong>{sent.toLocaleString()}</strong>
                  <span>emails sent</span>
                </div>
                <ul className="os-badges" aria-hidden="true">
                  <li className="is-sent">Sent {sent.toLocaleString()}</li>
                  <li className="is-open">Opened {opened.toLocaleString()}</li>
                  <li className="is-reply">Replied {replied.toLocaleString()}</li>
                </ul>
              </footer>
            </article>
            <article className="os-float os-float-c">
              <small>Inbox</small>
              <strong>Maya replied</strong>
              <span>“Send the one-pager.”</span>
            </article>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
