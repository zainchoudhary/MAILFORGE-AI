import { useEffect, useRef, useState } from 'react';
import { useInView, useReducedMotion } from 'framer-motion';
import { AGENT_LINES } from './content';

export function Agent() {
  const reduced = useReducedMotion();
  const ref = useRef(null);
  const live = useInView(ref, { amount: 0.45 });
  const [done, setDone] = useState(reduced ? AGENT_LINES.length : 0);
  const [partial, setPartial] = useState(reduced ? '' : '');

  useEffect(() => {
    if (reduced || !live) return undefined;
    let cancelled = false;
    let timer = 0;
    const wait = (ms) => new Promise((resolve) => {
      timer = window.setTimeout(resolve, ms);
    });

    const run = async () => {
      while (!cancelled) {
        for (let line = 0; line < AGENT_LINES.length && !cancelled; line += 1) {
          const text = AGENT_LINES[line].text;
          setDone(line);
          for (let count = 1; count <= text.length && !cancelled; count += 1) {
            setPartial(text.slice(0, count));
            await wait(14);
          }
          await wait(460);
        }
        await wait(1800);
        if (!cancelled) {
          setDone(0);
          setPartial('');
        }
      }
    };
    run();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [live, reduced]);

  const visible = reduced ? AGENT_LINES.length : done;

  return (
    <section className="os-section" id="agent" ref={ref}>
      <div className="os-shell os-agent-grid">
        <div className="os-head">
          <p className="os-kicker"><span>06</span>BD agent</p>
          <h2>It thinks out loud, then hands you a list.</h2>
          <p>A search, a score, a draft. You still get the last word before anything is addressed to a stranger.</p>
        </div>
        <div className="os-terminal" aria-live="polite">
          <header>
            <i /><i /><i />
            <span>bd-agent</span>
          </header>
          <div className="os-terminal-body">
            {AGENT_LINES.slice(0, visible).map((line) => (
              <p key={line.text} className={`is-${line.kind}`}>{line.text}</p>
            ))}
            {!reduced && visible < AGENT_LINES.length ? (
              <p className={`is-${AGENT_LINES[visible].kind}`}>
                {partial}
                <i />
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
