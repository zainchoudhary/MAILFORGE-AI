# DataStream-style Landing Implementation Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox syntax.

**Goal:** Ship a DataStream-layout landing page for Outreach Studio with app colors and no theme toggle.

**Architecture:** In-place rewrite of Landing.jsx + landing.css; Brand + auth CTAs unchanged.

**Tech Stack:** React, existing landing CSS file, lucide-react icons.

## Global Constraints
- Only `frontend/src/pages/Landing.jsx` and `frontend/src/styles/landing.css`
- No landing light/dark toggle or `mf_landing_theme`
- App palette blues/indigos; no DataStream asset copies
- Brand is hero-level; one primary CTA in hero

---

### Task 1: Rewrite landing markup + styles

- [ ] Replace Landing.jsx with DataStream section order and product copy
- [ ] Replace landing.css with light-only nonprofit layout styles
- [ ] Verify `/` loads, nav anchors work, Sign up / Open app routes work, no theme toggle
