import { ShieldCheck, Sparkles } from 'lucide-react';
import { Brand } from './Brand';

export function AuthShell({
  pill = 'Secure workspace',
  eyebrow = 'OUTREACH, MADE INTENTIONAL',
  title = (
    <>
      Better outreach.
      <br />
      More meaningful
      <br />
      <em>conversations.</em>
    </>
  ),
  description = 'Turn documents into thoughtful, accountable communication from one focused workspace.',
  children,
}) {
  return (
    <div className="auth-page">
      <section className="auth-story" aria-label="Outreach Studio overview">
        <div className="auth-story-nav">
          <Brand />
          <span className="auth-security-pill">
            <ShieldCheck size={14} /> {pill}
          </span>
        </div>
        <div className="auth-story-content">
          <div className="eyebrow">
            <Sparkles size={14} /> {eyebrow}
          </div>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        <small className="auth-story-foot">Built for thoughtful communication.</small>
      </section>
      <section className="auth-form">{children}</section>
    </div>
  );
}
