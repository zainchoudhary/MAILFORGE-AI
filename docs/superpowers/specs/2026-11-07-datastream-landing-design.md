# DataStream-style Landing — Outreach Studio

## Goal
Replace the marketing landing page with a full layout clone of [DataStream](https://datastream.org/en-ca/) structure, using Outreach Studio product copy and the existing blue/indigo palette. Light-only (no landing theme toggle).

## Approach
Rewrite `frontend/src/pages/Landing.jsx` and `frontend/src/styles/landing.css` in place. Keep `Brand`, auth-aware CTAs (`/login`, `/overview`), and mailto contact. Use abstract CSS product panels instead of stock/DataStream photos.

## Section order
1. Top nav (Mission, Product, How it works, Contact + Sign up)
2. Hero (brand-forward headline, one subline, one CTA, abstract workspace panel)
3. Stats strip (campaigns / recipients / delivery — product framing)
4. Mission
5. Vision
6. Outreach cycle (Import → Compose & review → Approve & send → Learn)
7. Use-case chips (recruiters, founders, agencies)
8. Contact + footer

## Non-goals
No app/workspace changes. No dark-mode on landing. No backend. No Lead Finder / email verification work.

## Colors
Reuse existing landing tokens: `#6488f6`, `#4f46e5`, slate ink/mute, soft panels.
