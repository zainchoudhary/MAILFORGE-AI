import { useEffect, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { DEMO_RECIPIENTS } from './content';

const TOTAL = 5000;

export function Demo() {
  const reduced = useReducedMotion();
  const [phase, setPhase] = useState('idle');
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (phase !== 'sending') return undefined;
    if (reduced) {
      setProgress(1);
      setPhase('done');
      return undefined;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now) => {
      const next = Math.min(1, (now - start) / 2200);
      setProgress(1 - (1 - next) ** 3);
      if (next < 1) frame = requestAnimationFrame(tick);
      else setPhase('done');
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [phase, reduced]);

  const sent = Math.round(progress * TOTAL);
  const opened = Math.round(sent * 0.37);
  const replied = Math.round(sent * 0.06);

  const send = () => {
    if (phase === 'sending') return;
    setProgress(0);
    setPhase('sending');
  };

  return (
    <section className="os-section" id="demo">
      <div className="os-shell os-demo-grid">
        <div className="os-head">
          <p className="os-kicker"><span>05</span>Try a send</p>
          <h2>Press the button. Watch one email leave for five thousand people.</h2>
          <p>This is a rehearsal on the page, not your mailbox. The real send still waits for you inside the workspace.</p>
        </div>
        <div className={`os-demo ${phase === 'sending' ? 'is-sending' : ''}`}>
          <header>
            <span>Campaign builder</span>
            <strong>Series A founders</strong>
          </header>
          <div className="os-demo-body">
            <div>
              <p className="os-demo-label">Template</p>
              <p className="os-demo-value">First touch · “A note after the round”</p>
              <p className="os-demo-label">Audience</p>
              <ul className="os-demo-people">
                {DEMO_RECIPIENTS.map((name) => <li key={name}>{name}</li>)}
                <li>+ 4,996 more</li>
              </ul>
              <button type="button" className="os-btn os-btn-primary" onClick={send} disabled={phase === 'sending'}>
                {phase === 'done' ? 'Send it again' : 'Send campaign'}
              </button>
            </div>
            <div className="os-demo-stage" aria-hidden="true">
              {Array.from({ length: 8 }, (_, index) => <i key={index} className="os-env" style={{ '--i': index }} />)}
            </div>
          </div>
          <div className="os-progress" aria-hidden="true">
            <span style={{ transform: `scaleX(${progress})` }} />
          </div>
          <dl className="os-demo-stats">
            <div><dt>Sent</dt><dd>{sent.toLocaleString()}</dd></div>
            <div><dt>Opened</dt><dd>{opened.toLocaleString()}</dd></div>
            <div><dt>Replied</dt><dd>{replied.toLocaleString()}</dd></div>
          </dl>
          <p className="os-live" role="status">
            {phase === 'sending' ? 'Sending campaign.' : ''}
            {phase === 'done' ? 'Rehearsal complete. 5,000 emails accounted for.' : ''}
          </p>
        </div>
      </div>
    </section>
  );
}
