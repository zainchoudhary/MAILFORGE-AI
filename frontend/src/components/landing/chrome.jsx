import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion, useMotionValue, useReducedMotion, useSpring } from 'framer-motion';
import { ArrowUp, Menu, Moon, Sun, X } from 'lucide-react';
import { Brand } from '../Brand';
import { NAV } from './content';
import { GlowLink, markIntroPlayed, scrollToY, shouldPlayIntro } from './kit';

export function Backdrop() {
  return (
    <div className="os-backdrop" aria-hidden="true">
      <span className="os-orb os-orb-a" />
      <span className="os-orb os-orb-b" />
      <span className="os-orb os-orb-c" />
      <span className="os-gridbg" />
      <span className="os-noise" />
    </div>
  );
}

export function CursorGlow() {
  const reduced = useReducedMotion();
  const [on, setOn] = useState(false);
  const x = useMotionValue(-400);
  const y = useMotionValue(-400);
  const springX = useSpring(x, { stiffness: 150, damping: 26, mass: 0.4 });
  const springY = useSpring(y, { stiffness: 150, damping: 26, mass: 0.4 });

  useEffect(() => {
    if (reduced || !window.matchMedia('(pointer: fine)').matches) return undefined;
    setOn(true);
    const move = (event) => {
      x.set(event.clientX);
      y.set(event.clientY);
    };
    window.addEventListener('pointermove', move, { passive: true });
    return () => window.removeEventListener('pointermove', move);
  }, [reduced, x, y]);

  if (!on) return null;

  return <motion.div aria-hidden="true" className="os-cursor" style={{ x: springX, y: springY }} />;
}

export function Intro() {
  const [show, setShow] = useState(shouldPlayIntro);

  useEffect(() => {
    if (!show) return undefined;
    markIntroPlayed();
    const timer = window.setTimeout(() => setShow(false), 1100);
    return () => window.clearTimeout(timer);
  }, [show]);

  if (!show) return null;

  return (
    <div className="os-intro" role="presentation" aria-hidden="true">
      <motion.span
        className="os-curtain os-curtain-left"
        initial={{ x: '0%' }}
        animate={{ x: '-100%' }}
        transition={{ delay: 0.22, duration: 0.78, ease: [0.76, 0, 0.24, 1] }}
      />
      <motion.span
        className="os-curtain os-curtain-right"
        initial={{ x: '0%' }}
        animate={{ x: '100%' }}
        transition={{ delay: 0.22, duration: 0.78, ease: [0.76, 0, 0.24, 1] }}
      />
    </div>
  );
}

export function BackToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 520);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <AnimatePresence>
      {visible ? (
        <motion.button
          type="button"
          className="os-top"
          aria-label="Back to top"
          title="Back to top"
          initial={{ opacity: 0, y: 12, scale: 0.92 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.92 }}
          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          onClick={() => scrollToY(0)}
        >
          <ArrowUp size={18} strokeWidth={2.25} aria-hidden="true" />
        </motion.button>
      ) : null}
    </AnimatePresence>
  );
}

export function Nav({ startTo, loginTo, cta, loginLabel, theme = 'dark', onToggleTheme }) {
  const [open, setOpen] = useState(false);
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    const onScroll = () => setCompact(window.scrollY > 20);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const close = () => setOpen(false);

  return (
    <header className={`os-nav-wrap ${compact ? 'is-compact' : ''}`}>
      <div className="os-nav">
        <a href="#top" className="os-brand" aria-label="Outreach Studio home" onClick={close}>
          <Brand />
        </a>
        <nav className="os-nav-links" aria-label="Primary">
          {NAV.map(([label, href]) => (
            <a key={href} href={href}>{label}</a>
          ))}
        </nav>
        <div className="os-nav-actions">
          {typeof onToggleTheme === 'function' ? (
            <button
              type="button"
              className="os-theme-toggle"
              onClick={onToggleTheme}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
            >
              {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
            </button>
          ) : null}
          <Link className="os-login" to={loginTo}>{loginLabel}</Link>
          <GlowLink to={startTo}>{cta}</GlowLink>
          <button
            type="button"
            className="os-burger"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>
      <div className={`os-drawer ${open ? 'is-open' : ''}`} hidden={!open}>
        {NAV.map(([label, href]) => (
          <a key={href} href={href} onClick={close}>{label}</a>
        ))}
        <Link to={loginTo} onClick={close}>{loginLabel}</Link>
        <Link className="os-btn os-btn-primary" to={startTo} onClick={close}>{cta}</Link>
      </div>
    </header>
  );
}
