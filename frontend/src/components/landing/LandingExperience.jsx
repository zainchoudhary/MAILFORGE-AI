import { useState } from 'react';
import { MotionConfig } from 'framer-motion';
import { Agent } from './Agent';
import { Bento } from './Bento';
import { Demo } from './Demo';
import { Hero } from './Hero';
import { How } from './How';
import { Proof } from './Proof';
import { Story } from './Story';
import { Backdrop, BackToTop, CursorGlow, Intro, Nav } from './chrome';
import { LANDING_THEME_KEY, useLandingSeo, useLenis } from './kit';
import { Contact, Faq, Footer, Pricing, Stats, Voices } from './rest';
import './landing.css';

function readLandingTheme() {
  try {
    return localStorage.getItem(LANDING_THEME_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export default function LandingExperience({ authenticated }) {
  useLandingSeo();
  useLenis();
  const [theme, setTheme] = useState(readLandingTheme);

  const toggleTheme = () => {
    setTheme((current) => {
      const next = current === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(LANDING_THEME_KEY, next); } catch { /* ignore */ }
      return next;
    });
  };

  const startTo = authenticated ? '/overview' : '/register';
  const loginTo = authenticated ? '/overview' : '/login';
  const cta = authenticated ? 'Open studio' : 'Get started';
  const loginLabel = authenticated ? 'Workspace' : 'Login';

  return (
    <MotionConfig reducedMotion="user">
      <div className="landing os-land" id="top" data-theme={theme}>
        <a className="os-skip" href="#main">Skip to content</a>
        <Backdrop />
        <CursorGlow />
        <Intro />
        <Nav
          startTo={startTo}
          loginTo={loginTo}
          cta={cta}
          loginLabel={loginLabel}
          theme={theme}
          onToggleTheme={toggleTheme}
        />
        <main id="main">
          <Hero startTo={startTo} />
          <Proof />
          <Story />
          <Bento />
          <How />
          <Demo />
          <Agent />
          <Stats />
          <Pricing startTo={startTo} />
          <Voices />
          <Faq />
          <Contact />
        </main>
        <Footer startTo={startTo} loginTo={loginTo} />
        <BackToTop />
      </div>
    </MotionConfig>
  );
}
