import { useRef, useState } from 'react';
import { AnimatePresence, motion, useMotionValueEvent, useScroll } from 'framer-motion';
import { EASE, STEPS } from './content';
import { scrollToY, useCompact } from './kit';

function StepVisual({ step }) {
  if (step === 0) {
    return (
      <div className="os-panel-view">
        <p className="os-kicker">Leads</p>
        <div className="os-import">
          <span>Drop a CSV, or let the agent search</span>
          <ul>
            <li>Amina Shah · Harbor · 92</li>
            <li>Jonah Lee · Kite · 88</li>
            <li>Priya Raman · Fieldwork · 81</li>
          </ul>
        </div>
      </div>
    );
  }
  if (step === 1) {
    return (
      <div className="os-panel-view">
        <p className="os-kicker">Template</p>
        <div className="os-import">
          <strong>Subject · Quick note, {'{{company}}'}</strong>
          <p>Hi {'{{first_name}}'} — I had a reason to write that is actually about {'{{company}}'}.</p>
        </div>
      </div>
    );
  }
  if (step === 2) {
    return (
      <div className="os-panel-view">
        <p className="os-kicker">Launch</p>
        <div className="os-import os-launch">
          <span>Founders · US</span>
          <strong>5,000 recipients</strong>
          <i />
        </div>
      </div>
    );
  }
  return (
    <div className="os-panel-view">
      <p className="os-kicker">Follow-ups</p>
      <ol className="os-follow">
        <li><b>Day 0</b> First note sent</li>
        <li><b>Day 3</b> Queued</li>
        <li><b>Day 7</b> Last touch, then stop</li>
      </ol>
    </div>
  );
}

function HowStack() {
  return (
    <section className="os-section" id="how">
      <div className="os-shell">
        <div className="os-head">
          <p className="os-kicker"><span>04</span>How it works</p>
          <h2>Four steps. Then it keeps the promise you made to follow up.</h2>
        </div>
        <ol className="os-how-stack">
          {STEPS.map((step, index) => (
            <li key={step.index}>
              <span>{step.index}</span>
              <div>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
                <StepVisual step={index} />
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function HowPin() {
  const ref = useRef(null);
  const [step, setStep] = useState(0);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] });

  useMotionValueEvent(scrollYProgress, 'change', (value) => {
    const next = Math.min(STEPS.length - 1, Math.max(0, Math.floor(value * STEPS.length)));
    setStep((current) => (current === next ? current : next));
  });

  const go = (index) => {
    const node = ref.current;
    if (!node) return;
    const travel = node.offsetHeight - window.innerHeight;
    scrollToY(node.offsetTop + (travel * index) / (STEPS.length - 1));
  };

  return (
    <section className="os-how" id="how" ref={ref}>
      <div className="os-how-sticky">
        <div className="os-shell os-how-grid">
          <div>
            <p className="os-kicker"><span>04</span>How it works</p>
            <h2>Four steps. Then it keeps the promise you made to follow up.</h2>
            <ol className="os-steps">
              <span className="os-rail" aria-hidden="true">
                <motion.i style={{ scaleY: scrollYProgress }} />
              </span>
              {STEPS.map((item, index) => (
                <li key={item.index} className={step === index ? 'is-active' : ''}>
                  <button type="button" onClick={() => go(index)} aria-current={step === index ? 'step' : undefined}>
                    <span>{item.index}</span>
                    <span>
                      <strong>{item.title}</strong>
                      <small>{item.body}</small>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </div>
          <div className="os-how-visual" aria-live="polite">
            <AnimatePresence mode="wait">
              <motion.div
                key={step}
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.45, ease: EASE }}
              >
                <StepVisual step={step} />
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  );
}

export function How() {
  const compact = useCompact();
  return compact ? <HowStack /> : <HowPin />;
}
