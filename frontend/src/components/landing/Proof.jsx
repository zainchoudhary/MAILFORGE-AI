import { useRef } from 'react';
import { useInView } from 'framer-motion';
import { LOGOS, PROOF_STATS } from './content';
import { Counter } from './kit';

export function Proof() {
  const ref = useRef(null);
  const active = useInView(ref, { once: true, amount: 0.6 });

  return (
    <section className="os-proof" aria-label="Sample volume">
      <div className="os-shell">
        <div className="os-proof-stats" ref={ref}>
          {PROOF_STATS.map((stat) => (
            <p key={stat.label}>
              <Counter to={stat.value} active={active} suffix={stat.suffix} />
              <span>{stat.label}</span>
            </p>
          ))}
        </div>
      </div>
      <div className="os-marquee" aria-label="Teams using sample workspaces">
        <div className="os-marquee-track">
          {[0, 1].map((copy) => (
            <div className="os-marquee-group" key={copy} aria-hidden={copy === 1}>
              {LOGOS.map((name) => (
                <span className="os-logo" key={`${copy}-${name}`}>{name}</span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
