import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, useMotionValue, useReducedMotion } from 'framer-motion';
import Lenis from 'lenis';
import { DESCRIPTION, EASE, TITLE } from './content';

/** Shared Lenis instance so in-page controls can scroll without fighting the smoother. */
export const lenisRef = { current: null };

/** Landing-only theme key — never shared with the workspace theme. */
export const LANDING_THEME_KEY = 'mf_landing_theme';

let introPlayed = false;

export function shouldPlayIntro() {
  if (introPlayed) return false;
  if (typeof window === 'undefined') return false;
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function markIntroPlayed() {
  introPlayed = true;
}

export function useLenis() {
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const fine = window.matchMedia('(pointer: fine)').matches;
    if (reduced || !fine) return undefined;

    const lenis = new Lenis({
      autoRaf: true,
      lerp: 0.085,
      smoothWheel: true,
      syncTouch: false,
      anchors: { offset: -88 },
      stopInertiaOnNavigate: true,
    });
    lenisRef.current = lenis;
    return () => {
      lenisRef.current = null;
      lenis.destroy();
    };
  }, []);
}

export function scrollToY(top) {
  if (lenisRef.current) {
    lenisRef.current.scrollTo(top);
    return;
  }
  window.scrollTo({ top, behavior: 'smooth' });
}

/** Stack scroll-pinned stories when the screen is narrow or too short to hold them. */
export function useCompact() {
  const query = '(max-width: 900px), (max-height: 760px)';
  const [compact, setCompact] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);

  useEffect(() => {
    const media = window.matchMedia(query);
    const apply = () => setCompact(media.matches);
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [query]);

  return compact;
}

export function useNarrow(max = 900) {
  const query = `(max-width: ${max}px)`;
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);

  useEffect(() => {
    const media = window.matchMedia(query);
    const apply = () => setNarrow(media.matches);
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [query]);

  return narrow;
}

export function useCountUp(target, active, duration = 1500) {
  const reduced = useReducedMotion();
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (!active) return undefined;
    if (reduced) {
      setValue(target);
      return undefined;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - progress) ** 3;
      setValue(Math.round(target * eased));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active, duration, reduced, target]);

  return value;
}

export function Counter({ to, active, suffix = '', className = '' }) {
  const value = useCountUp(to, active);
  return <span className={className}>{value.toLocaleString()}{suffix}</span>;
}

export function Reveal({ children, className = '', delay = 0 }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 26 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.35 }}
      transition={{ duration: 0.7, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

export function SectionHead({ index, kicker, title, body }) {
  return (
    <Reveal className="os-head">
      <p className="os-kicker"><span>{index}</span>{kicker}</p>
      <h2>{title}</h2>
      {body ? <p>{body}</p> : null}
    </Reveal>
  );
}

export function GlowLink({ to, children, className = '' }) {
  const reduced = useReducedMotion();
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  const onMove = (event) => {
    if (reduced) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    x.set((event.clientX - (bounds.left + bounds.width / 2)) * 0.22);
    y.set((event.clientY - (bounds.top + bounds.height / 2)) * 0.32);
  };

  return (
    <motion.span
      className={`os-magnetic ${className}`}
      style={{ x, y }}
      onPointerMove={onMove}
      onPointerLeave={() => {
        x.set(0);
        y.set(0);
      }}
    >
      <Link to={to} className="os-btn os-btn-primary">
        {children}
      </Link>
    </motion.span>
  );
}

export function useLandingSeo() {
  useEffect(() => {
    document.title = TITLE;

    const description = document.querySelector('meta[name="description"]');
    const previousDescription = description?.getAttribute('content') ?? '';
    description?.setAttribute('content', DESCRIPTION);

    const theme = document.querySelector('meta[name="theme-color"]');
    const previousTheme = theme?.getAttribute('content') ?? '';
    theme?.setAttribute('content', '#090e1a');

    const tags = [
      ['property', 'og:title', TITLE],
      ['property', 'og:description', DESCRIPTION],
      ['property', 'og:type', 'website'],
      ['name', 'twitter:card', 'summary_large_image'],
    ].map(([attr, key, content]) => {
      let node = document.head.querySelector(`meta[${attr}="${key}"]`);
      let wasCreated = false;
      if (!node) {
        node = document.createElement('meta');
        node.setAttribute(attr, key);
        document.head.appendChild(node);
        wasCreated = true;
      }
      const previous = node.getAttribute('content');
      node.setAttribute('content', content);
      return { node, previous, wasCreated };
    });

    return () => {
      // Leave document.title for the next route's title hook.
      description?.setAttribute('content', previousDescription);
      if (theme) theme.setAttribute('content', previousTheme);
      tags.forEach(({ node, previous, wasCreated }) => {
        if (wasCreated) node.remove();
        else if (previous == null) node.removeAttribute('content');
        else node.setAttribute('content', previous);
      });
    };
  }, []);
}
