# Dark Mode — Outreach Studio

## Goal
Persistent Light/Dark theme across the whole app without changing Light Mode visuals or business logic.

## Approach
`data-theme="light|dark"` on `<html>`, FOUC-safe bootstrap script, `localStorage` key `mf_theme`, first visit follows `prefers-color-scheme`. Sidebar footer toggle. CSS tokens + `[data-theme="dark"]` overrides for the light enterprise stylesheet, landing, auth, toasts.

## Non-goals
No API/auth/campaign logic changes. No Light Mode redesign. No new dependencies.
