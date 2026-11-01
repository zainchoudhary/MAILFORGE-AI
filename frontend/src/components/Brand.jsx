export function OutreachMark({ className = '' }) {
  return (
    <svg className={`outreach-mark ${className}`} viewBox="0 0 40 40" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="outreach-gradient" x1="5" y1="4" x2="35" y2="36" gradientUnits="userSpaceOnUse">
          <stop stopColor="#60A5FA" />
          <stop offset="1" stopColor="#4F46E5" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="36" height="36" rx="11" fill="url(#outreach-gradient)" />
      <path d="M10 14.5 20 20l10-5.5v11L20 31l-10-5.5v-11Z" fill="none" stroke="white" strokeWidth="2.3" strokeLinejoin="round" />
      <path d="m10.5 15 9.5 7 9.5-7" fill="none" stroke="white" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="31.5" cy="9" r="3.5" fill="#34D399" stroke="white" strokeWidth="1.5" />
    </svg>
  );
}

export function Brand({ compact = false }) {
  return (
    <span className={`brand ${compact ? 'brand-compact' : ''}`}>
      <OutreachMark />
      {!compact && <span className="brand-name">Outreach <b>Studio</b></span>}
    </span>
  );
}
