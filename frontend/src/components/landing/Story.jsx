import { useRef, useState } from 'react';
import { AnimatePresence, motion, useMotionValueEvent, useScroll } from 'framer-motion';
import { EASE } from './content';
import { useCompact } from './kit';

const CHAOS = [
  ['BCC', '214 people on one thread', 'danger', '-8deg', '6%', '4%'],
  ['File', 'Copy of Copy of leads.xlsx', 'warn', '4deg', '52%', '10%'],
  ['Drafts', 'Follow-up never left', 'mute', '-3deg', '10%', '52%'],
  ['Tabs', 'LinkedIn, closed, forgotten', 'warn', '7deg', '48%', '58%'],
];

const PIPE = ['Find', 'Write', 'Send', 'Follow up'];

function ChaosBoard() {
  return (
    <div className="os-chaos" aria-hidden="true">
      <div className="os-chaos-desk">
        <span className="os-chaos-spill" />
        <span className="os-chaos-spill is-b" />
        {CHAOS.map(([label, text, tone, rot, left, top], index) => (
          <article
            key={label}
            className={`is-${tone}`}
            style={{ '--i': index, '--rot': rot, left, top }}
          >
            <header>
              <small>{label}</small>
              <em />
            </header>
            <strong>{text}</strong>
          </article>
        ))}
      </div>
    </div>
  );
}

function PipelineBoard() {
  return (
    <div className="os-pipe" aria-hidden="true">
      <p className="os-kicker"><span>Now</span>One pipeline</p>
      <div className="os-pipe-steps">
        {PIPE.map((step, index) => (
          <div key={step} style={{ '--i': index }}>
            <span>0{index + 1}</span>
            <strong>{step}</strong>
            {index < PIPE.length - 1 ? <i /> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function StoryCopy({ phase = 'mess' }) {
  return (
    <div className="os-story-copy">
      <p className="os-kicker"><span>02</span>The mess, then the desk</p>
      <h2>Twelve tabs. One tired operator. A follow-up that never left drafts.</h2>
      <p>Cold outreach breaks in the gaps between the spreadsheet, the template, and the reminder you meant to set. The same work fits on one pipeline.</p>
      <p className="os-story-phase" aria-live="polite">
        {phase === 'mess' ? 'Before · scattered tools' : 'After · one pipeline'}
      </p>
    </div>
  );
}

function StoryStack() {
  return (
    <section className="os-section">
      <div className="os-shell os-story-stack">
        <StoryCopy />
        <ChaosBoard />
        <PipelineBoard />
      </div>
    </section>
  );
}

function StoryScroll() {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] });
  const [phase, setPhase] = useState('mess');

  useMotionValueEvent(scrollYProgress, 'change', (value) => {
    const next = value < 0.48 ? 'mess' : 'clean';
    setPhase((current) => (current === next ? current : next));
  });

  return (
    <section className="os-story" ref={ref}>
      <div className="os-story-sticky">
        <div className="os-shell os-story-grid">
          <div>
            <StoryCopy phase={phase} />
            <div className="os-meter" aria-hidden="true">
              <motion.span style={{ scaleX: scrollYProgress }} />
            </div>
          </div>
          <div className="os-story-stage">
            <AnimatePresence mode="wait">
              {phase === 'mess' ? (
                <motion.div
                  key="mess"
                  className="os-story-layer"
                  initial={{ opacity: 0, scale: 0.98, filter: 'blur(6px)' }}
                  animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                  exit={{ opacity: 0, scale: 1.02, filter: 'blur(6px)' }}
                  transition={{ duration: 0.34, ease: EASE }}
                >
                  <ChaosBoard />
                </motion.div>
              ) : (
                <motion.div
                  key="clean"
                  className="os-story-layer os-story-clean"
                  initial={{ opacity: 0, y: 18, filter: 'blur(6px)' }}
                  animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                  exit={{ opacity: 0, y: -10, filter: 'blur(6px)' }}
                  transition={{ duration: 0.38, ease: EASE }}
                >
                  <PipelineBoard />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  );
}

export function Story() {
  const compact = useCompact();
  return compact ? <StoryStack /> : <StoryScroll />;
}
