---
title: TAI Marketing Page
date: 2026-05-10
status: draft
---

# TAI Marketing Page — Design

## Goal

A single-page marketing site for TAI, hosted on GitHub Pages at `darkharasho.github.io/tai`, auto-publishing on every push to `main`.

## Hosting & publishing

- **Source:** `main` branch, `/docs` folder (GitHub Pages setting).
- **No Actions workflow** — Pages republishes automatically on push.
- **URL:** `https://darkharasho.github.io/tai/`
- **No custom domain.** No `CNAME` file.
- `docs/screenshots/` already exists and stays in place; it doubles as the asset folder for the site.
- `docs/superpowers/specs/` exists but is not linked from the site (effectively hidden).

## Tech

- Single static `docs/index.html`.
- Co-located `docs/styles.css` and `docs/script.js` (split for readability; small enough not to need a bundler).
- No frameworks, no build step, no dependencies. Fonts via Google Fonts CDN (or system stack — see Typography).
- Favicon reuses `public/img/tai.png` (copied to `docs/favicon.png`).

## Visual direction (Hybrid — option C)

- **Palette:** near-black base (`#0a0a0c`), elevated surface (`#13131a`), TAI green accent (`#00a884` — matches existing README badges), soft purple/teal radial gradients in hero/section backgrounds, muted gray text (`#a8a8b3`), white headings.
- **Typography:** Inter (display + body) + JetBrains Mono (terminal/code). Loaded from Google Fonts with `display=swap`; system fallbacks ensure no FOIT.
- **Cards:** frosted-glass (subtle backdrop-blur + 1px border at 8% white).
- **Motion:** scroll-triggered fade-up on sections (IntersectionObserver, ~400ms). Animated terminal in hero loops.
- **Responsive:** mobile-first; single column under 768px, 2-col features under 1024px, 3-col above.

## Sections

1. **Sticky nav** — TAI logo (image + wordmark), links: Features, Shortcuts, Download, GitHub. Translucent dark with backdrop-blur. Collapses to hamburger on mobile.

2. **Hero**
   - H1: "Your terminal, but smarter." (gradient text)
   - Subhead: one-liner from README ("An AI-native terminal that understands what you're doing.")
   - CTAs: primary "Download for Linux" (links to latest release), secondary "View on GitHub".
   - **Animated terminal demo** (the centerpiece): a faux terminal window with traffic-light buttons. JS-driven loop:
     1. Types `fix the failing test`
     2. Ghost-text suggestion appears: `npm test -- --watch`
     3. Switches to AI mode banner, Claude "suggests" `npm test --workspace=app --watch` with [Enter approve] [E edit] [Esc reject] hints
     4. "Approved" → output streams in
     5. Resets after a beat.
   - Subtle radial gradient behind the terminal.

3. **Feature grid** (6 cards, README-derived):
   - Natural language in the prompt
   - Command suggestions with approval
   - Ghost-text predictions
   - Block-based output
   - Multi-tab sessions
   - System tray
   - Each card: Lucide-style inline SVG icon, title, 2-line description.

4. **Screenshot showcase** — two existing screenshots (`docs/screenshots/terminal.png`, `ai-mode.png`) in a 2-col grid (stacks on mobile). Subtle border, drop shadow, captions.

5. **Keyboard shortcuts** — styled grid of `<kbd>` chips paired with action labels. Pulled directly from the README table.

6. **Quick start** — two code blocks (download/install, build from source) with one-click copy buttons (clipboard API + checkmark state).

7. **Footer** — license, GitHub link, tagline "Built for developers who think in terminals."

## File layout

```
docs/
  index.html
  styles.css
  script.js
  favicon.png            # copied from public/img/tai.png
  screenshots/           # existing
    terminal.png
    ai-mode.png
  superpowers/           # existing (not linked from site)
```

## Accessibility

- Semantic landmarks (`<nav>`, `<main>`, `<section>`, `<footer>`).
- Visible focus rings on all interactive elements.
- All images have descriptive `alt` text.
- `prefers-reduced-motion`: disables the terminal animation loop and scroll fade-ups.
- Color contrast ≥ WCAG AA against the dark base.

## Out of scope (YAGNI)

- No FAQ, roadmap, comparison-vs-Warp, blog, or changelog pages.
- No analytics.
- No newsletter / email capture.
- No dark/light toggle — dark only.
- No download detection by OS (Linux-only release today; single "Download for Linux" CTA).
- No build pipeline / Actions workflow.

## Done criteria

- Pushing to `main` updates the live site within ~1 minute.
- Lighthouse: Performance ≥ 90, Accessibility ≥ 95 on desktop.
- Page is usable on 375px-wide mobile.
- Hero terminal animation runs smoothly and pauses with `prefers-reduced-motion`.
