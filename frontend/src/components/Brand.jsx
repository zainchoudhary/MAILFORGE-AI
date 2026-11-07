const MARK_SRC = '/logo/outreach-studio.svg';
const MARK_PNG = '/logo/outreach-studio.png';

/** Crisp vector mark (PNG kept in /public/logo as source asset). */
export function OutreachMark({ className = '', title }) {
  return (
    <img
      className={`outreach-mark ${className}`}
      src={MARK_SRC}
      alt={title || ''}
      aria-hidden={title ? undefined : true}
      draggable={false}
      decoding="async"
    />
  );
}

export function Brand({ compact = false, withTagline = false }) {
  return (
    <span className={`brand ${compact ? 'brand-compact' : ''}${withTagline ? ' brand-with-tagline' : ''}`}>
      <OutreachMark />
      {!compact && (
        <span className="brand-copy">
          <span className="brand-name">
            Outreach <b>Studio</b>
          </span>
          {withTagline ? <span className="brand-tagline">Find · Connect · Outreach</span> : null}
        </span>
      )}
    </span>
  );
}

/** Larger logo image for dark panels / marketing. */
export function BrandLockup({ className = '', alt = 'Outreach Studio' }) {
  return (
    <img
      className={`brand-lockup ${className}`}
      src={MARK_PNG}
      alt={alt}
      draggable={false}
      decoding="async"
    />
  );
}
