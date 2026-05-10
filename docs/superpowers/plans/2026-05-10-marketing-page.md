# TAI Marketing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single-page marketing site for TAI at `docs/` that auto-publishes to GitHub Pages on every push to `main`.

**Architecture:** Static `index.html` + `styles.css` + `script.js` in `/docs`. No build step, no framework. GitHub Pages serves from `main:/docs`. Hero contains a JS-driven animated faux terminal; the rest is semantic HTML styled with a dark, gradient-accented design system inspired by Linear/Vercel.

**Tech Stack:** HTML5, modern CSS (custom properties, `backdrop-filter`, `grid`), vanilla JS (IntersectionObserver, Clipboard API), Google Fonts (Inter + JetBrains Mono).

**Spec:** `docs/superpowers/specs/2026-05-10-marketing-page-design.md`

**Note on testing:** This is a static marketing page, not a software unit, so TDD doesn't apply cleanly. Verification is done by opening the page in a real browser, checking each section against the spec, and running Lighthouse. Each task ends with a manual browser check before the commit step.

---

## Task 1: Scaffold files and favicon

**Files:**
- Create: `docs/index.html`
- Create: `docs/styles.css`
- Create: `docs/script.js`
- Create: `docs/favicon.png` (copy of `public/img/tai.png`)

- [ ] **Step 1: Copy favicon**

```bash
cp public/img/tai.png docs/favicon.png
```

- [ ] **Step 2: Create skeleton `docs/index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>TAI — Terminally AI</title>
  <meta name="description" content="An AI-native terminal that understands what you're doing. Claude built into the prompt — no mode switching, no copy-pasting." />
  <meta property="og:title" content="TAI — Terminally AI" />
  <meta property="og:description" content="An AI-native terminal that understands what you're doing." />
  <meta property="og:image" content="screenshots/terminal.png" />
  <meta name="theme-color" content="#0a0a0c" />
  <link rel="icon" href="favicon.png" type="image/png" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  <header id="nav"></header>
  <main id="main"></main>
  <footer id="footer"></footer>
  <script src="script.js" defer></script>
</body>
</html>
```

- [ ] **Step 3: Create empty `docs/styles.css` with CSS reset + design tokens**

```css
:root {
  --bg: #0a0a0c;
  --surface: #13131a;
  --surface-elevated: #1a1a23;
  --border: rgba(255, 255, 255, 0.08);
  --border-strong: rgba(255, 255, 255, 0.14);
  --text: #f4f4f7;
  --text-muted: #a8a8b3;
  --text-dim: #6b6b78;
  --accent: #00a884;
  --accent-glow: rgba(0, 168, 132, 0.35);
  --purple: #8b5cf6;
  --teal: #14b8a6;
  --radius: 12px;
  --radius-lg: 20px;
  --font-display: "Inter", system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace;
  --shadow-lg: 0 24px 48px -12px rgba(0, 0, 0, 0.6);
  --shadow-glow: 0 0 80px -20px var(--accent-glow);
}

*, *::before, *::after { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-display);
  font-size: 16px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
  overflow-x: hidden;
}
img { max-width: 100%; display: block; }
a { color: inherit; text-decoration: none; }
button { font: inherit; cursor: pointer; }

.skip-link {
  position: absolute;
  left: -9999px;
}
.skip-link:focus {
  left: 16px;
  top: 16px;
  background: var(--accent);
  color: #000;
  padding: 8px 12px;
  border-radius: 6px;
  z-index: 100;
}

:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
  border-radius: 4px;
}

.container {
  width: 100%;
  max-width: 1180px;
  margin: 0 auto;
  padding: 0 24px;
}
```

- [ ] **Step 4: Create empty `docs/script.js`**

```js
// Marketing page interactions. Sections wire themselves up after DOMContentLoaded.
document.addEventListener("DOMContentLoaded", () => {
  // populated by later tasks
});
```

- [ ] **Step 5: Open the file in a browser to confirm it loads**

```bash
xdg-open docs/index.html
```

Expected: blank dark page, no console errors, favicon visible in tab.

- [ ] **Step 6: Commit**

```bash
git add docs/index.html docs/styles.css docs/script.js docs/favicon.png
git commit -m "feat(site): scaffold marketing page"
```

---

## Task 2: Sticky nav

**Files:**
- Modify: `docs/index.html` (fill `<header id="nav">`)
- Modify: `docs/styles.css` (append nav styles)
- Modify: `docs/script.js` (mobile toggle)

- [ ] **Step 1: Add nav markup inside `<header id="nav">`**

```html
<header id="nav" class="nav">
  <div class="container nav__inner">
    <a class="nav__brand" href="#top" aria-label="TAI home">
      <img src="favicon.png" alt="" width="28" height="28" />
      <span>TAI</span>
    </a>
    <button class="nav__toggle" aria-expanded="false" aria-controls="nav-links" aria-label="Toggle navigation">
      <span></span><span></span><span></span>
    </button>
    <nav id="nav-links" class="nav__links">
      <a href="#features">Features</a>
      <a href="#shortcuts">Shortcuts</a>
      <a href="#install">Download</a>
      <a href="https://github.com/darkharasho/tai" rel="noopener">GitHub</a>
    </nav>
  </div>
</header>
```

- [ ] **Step 2: Append nav styles to `docs/styles.css`**

```css
.nav {
  position: sticky;
  top: 0;
  z-index: 50;
  background: rgba(10, 10, 12, 0.72);
  backdrop-filter: saturate(180%) blur(14px);
  -webkit-backdrop-filter: saturate(180%) blur(14px);
  border-bottom: 1px solid var(--border);
}
.nav__inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 64px;
}
.nav__brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-weight: 700;
  letter-spacing: 0.02em;
}
.nav__links {
  display: flex;
  gap: 28px;
  align-items: center;
}
.nav__links a {
  color: var(--text-muted);
  font-size: 14px;
  font-weight: 500;
  transition: color 0.15s ease;
}
.nav__links a:hover { color: var(--text); }
.nav__toggle {
  display: none;
  background: transparent;
  border: 0;
  width: 40px;
  height: 40px;
  padding: 8px;
  flex-direction: column;
  justify-content: space-between;
}
.nav__toggle span {
  display: block;
  height: 2px;
  background: var(--text);
  border-radius: 2px;
}
@media (max-width: 720px) {
  .nav__toggle { display: flex; }
  .nav__links {
    position: absolute;
    top: 64px;
    left: 0;
    right: 0;
    flex-direction: column;
    background: rgba(10, 10, 12, 0.96);
    backdrop-filter: blur(14px);
    padding: 16px 24px 24px;
    border-bottom: 1px solid var(--border);
    transform: translateY(-8px);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.15s ease, transform 0.15s ease;
  }
  .nav__links.is-open {
    opacity: 1;
    transform: translateY(0);
    pointer-events: auto;
  }
}
```

- [ ] **Step 3: Wire mobile toggle in `docs/script.js`**

Replace the body of the `DOMContentLoaded` handler with:

```js
document.addEventListener("DOMContentLoaded", () => {
  const toggle = document.querySelector(".nav__toggle");
  const links = document.querySelector(".nav__links");
  if (toggle && links) {
    toggle.addEventListener("click", () => {
      const open = links.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", String(open));
    });
    links.addEventListener("click", (e) => {
      if (e.target.tagName === "A") {
        links.classList.remove("is-open");
        toggle.setAttribute("aria-expanded", "false");
      }
    });
  }
});
```

- [ ] **Step 4: Reload the page in browser**

Expected: nav bar visible at top with logo and 4 links, sticky on scroll. Resize to 600px wide → hamburger appears, tapping it toggles the menu.

- [ ] **Step 5: Commit**

```bash
git add docs/index.html docs/styles.css docs/script.js
git commit -m "feat(site): add sticky nav with mobile menu"
```

---

## Task 3: Hero section (static layout)

**Files:**
- Modify: `docs/index.html` (add hero into `<main>`)
- Modify: `docs/styles.css` (hero styles)

- [ ] **Step 1: Add hero markup as the first child of `<main id="main">`**

```html
<section id="top" class="hero">
  <div class="hero__bg" aria-hidden="true"></div>
  <div class="container hero__inner">
    <div class="hero__copy">
      <span class="eyebrow">An AI-native terminal</span>
      <h1 class="hero__title">Your terminal,<br /><span class="grad">but smarter.</span></h1>
      <p class="hero__sub">Type a command, run it. Type a question, get an answer. No mode switching, no separate windows, no copy-pasting. TAI figures out which one you meant.</p>
      <div class="hero__cta">
        <a class="btn btn--primary" href="https://github.com/darkharasho/tai/releases/latest">
          Download for Linux
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg>
        </a>
        <a class="btn btn--ghost" href="https://github.com/darkharasho/tai">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .5a12 12 0 0 0-3.79 23.39c.6.11.82-.26.82-.58v-2.04c-3.34.73-4.04-1.61-4.04-1.61-.54-1.38-1.33-1.75-1.33-1.75-1.09-.74.08-.72.08-.72 1.2.08 1.83 1.23 1.83 1.23 1.07 1.83 2.81 1.3 3.5.99.11-.77.42-1.3.76-1.6-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.39 1.23-3.23-.12-.3-.53-1.52.12-3.17 0 0 1-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.29-1.55 3.3-1.23 3.3-1.23.65 1.65.24 2.87.12 3.17.77.84 1.23 1.92 1.23 3.23 0 4.61-2.81 5.62-5.48 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.21.7.83.58A12 12 0 0 0 12 .5Z"/></svg>
          View on GitHub
        </a>
      </div>
      <div class="hero__meta">
        <span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5L20 7"/></svg> MIT licensed</span>
        <span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5L20 7"/></svg> Open source</span>
        <span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5L20 7"/></svg> Powered by Claude</span>
      </div>
    </div>
    <div class="hero__demo">
      <div class="terminal" id="demo-terminal" aria-label="Animated TAI terminal demo" role="img">
        <div class="terminal__bar">
          <span class="terminal__dot" style="background:#ff5f57"></span>
          <span class="terminal__dot" style="background:#febc2e"></span>
          <span class="terminal__dot" style="background:#28c840"></span>
          <span class="terminal__title">tai — ~/projects/app</span>
        </div>
        <div class="terminal__body" id="demo-body"></div>
      </div>
    </div>
  </div>
</section>
```

- [ ] **Step 2: Append hero styles to `docs/styles.css`**

```css
.hero {
  position: relative;
  padding: 96px 0 80px;
  overflow: hidden;
}
.hero__bg {
  position: absolute;
  inset: -10% -10% auto -10%;
  height: 720px;
  background:
    radial-gradient(60% 50% at 20% 20%, rgba(139, 92, 246, 0.22), transparent 70%),
    radial-gradient(50% 40% at 80% 30%, rgba(0, 168, 132, 0.22), transparent 70%),
    radial-gradient(40% 40% at 50% 90%, rgba(20, 184, 166, 0.14), transparent 70%);
  filter: blur(8px);
  pointer-events: none;
}
.hero__inner {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.05fr);
  gap: 56px;
  align-items: center;
}
.eyebrow {
  display: inline-block;
  font-family: var(--font-mono);
  font-size: 12px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--accent);
  padding: 6px 10px;
  border: 1px solid var(--border-strong);
  border-radius: 999px;
  background: rgba(0, 168, 132, 0.06);
  margin-bottom: 20px;
}
.hero__title {
  font-size: clamp(40px, 6vw, 72px);
  line-height: 1.04;
  font-weight: 800;
  letter-spacing: -0.03em;
  margin: 0 0 20px;
}
.grad {
  background: linear-gradient(120deg, #00a884 0%, #14b8a6 35%, #8b5cf6 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.hero__sub {
  font-size: 18px;
  color: var(--text-muted);
  max-width: 540px;
  margin: 0 0 32px;
}
.hero__cta {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 28px;
}
.btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 12px 18px;
  border-radius: 10px;
  font-weight: 600;
  font-size: 15px;
  border: 1px solid transparent;
  transition: transform 0.12s ease, background 0.15s ease, border-color 0.15s ease;
}
.btn--primary {
  background: var(--accent);
  color: #04130f;
  box-shadow: var(--shadow-glow);
}
.btn--primary:hover { transform: translateY(-1px); background: #14c39a; }
.btn--ghost {
  background: rgba(255, 255, 255, 0.04);
  border-color: var(--border-strong);
  color: var(--text);
}
.btn--ghost:hover { background: rgba(255, 255, 255, 0.08); }
.hero__meta {
  display: flex;
  gap: 20px;
  flex-wrap: wrap;
  color: var(--text-dim);
  font-size: 13px;
}
.hero__meta span { display: inline-flex; align-items: center; gap: 6px; }
.hero__meta svg { color: var(--accent); }

.terminal {
  background: linear-gradient(180deg, #14141c 0%, #0e0e15 100%);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg), 0 0 0 1px rgba(255, 255, 255, 0.02) inset;
  overflow: hidden;
  font-family: var(--font-mono);
  font-size: 13.5px;
  line-height: 1.55;
}
.terminal__bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  background: rgba(255, 255, 255, 0.02);
  border-bottom: 1px solid var(--border);
}
.terminal__dot {
  width: 12px; height: 12px;
  border-radius: 50%;
  display: inline-block;
}
.terminal__title {
  margin-left: 12px;
  color: var(--text-dim);
  font-size: 12px;
}
.terminal__body {
  padding: 20px 22px;
  min-height: 360px;
  color: #d6d6e0;
  white-space: pre-wrap;
  word-break: break-word;
}

@media (max-width: 920px) {
  .hero { padding: 64px 0 56px; }
  .hero__inner { grid-template-columns: 1fr; gap: 40px; }
  .terminal__body { min-height: 280px; }
}
```

- [ ] **Step 3: Reload the page in browser**

Expected: hero with gradient background, eyebrow tag, large gradient headline, subhead, two buttons, three meta items on the left; an empty terminal window with traffic-light buttons on the right.

- [ ] **Step 4: Commit**

```bash
git add docs/index.html docs/styles.css
git commit -m "feat(site): add hero layout"
```

---

## Task 4: Animated terminal demo

**Files:**
- Modify: `docs/script.js` (add `runTerminalDemo`)
- Modify: `docs/styles.css` (terminal animation/typography classes)

- [ ] **Step 1: Append demo-specific styles to `docs/styles.css`**

```css
.t-prompt { color: var(--accent); }
.t-user { color: #e6e6ee; }
.t-ghost { color: rgba(255, 255, 255, 0.22); }
.t-dim { color: var(--text-dim); }
.t-ai { color: #c4b5fd; }
.t-ok { color: #4ade80; }
.t-err { color: #f87171; }
.t-banner {
  display: inline-block;
  margin: 8px 0;
  padding: 2px 8px;
  border-radius: 4px;
  background: rgba(139, 92, 246, 0.16);
  color: #c4b5fd;
  font-size: 12px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.t-kbd {
  display: inline-block;
  padding: 1px 6px;
  margin: 0 2px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--border-strong);
  color: var(--text);
  font-size: 11px;
}
.t-cursor {
  display: inline-block;
  width: 8px;
  height: 1.1em;
  background: var(--accent);
  vertical-align: text-bottom;
  margin-left: 1px;
  animation: blink 1s steps(2, end) infinite;
}
@keyframes blink {
  to { opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .t-cursor { animation: none; }
}
```

- [ ] **Step 2: Add the animation logic in `docs/script.js`**

Append the following inside the `DOMContentLoaded` handler, after the nav toggle code:

```js
const body = document.getElementById("demo-body");
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

if (body) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const promptHTML = '<span class="t-prompt">~/projects/app</span> <span class="t-dim">❯</span> ';

  async function typeInto(el, text, speed = 38) {
    for (const ch of text) {
      el.textContent += ch;
      if (!reduced) await sleep(speed + Math.random() * 30);
    }
  }

  function line(html) {
    const div = document.createElement("div");
    div.innerHTML = html;
    body.appendChild(div);
    return div;
  }

  async function frame() {
    body.innerHTML = "";

    // Frame 1: shell mode, typing with ghost suggestion
    const l1 = line(promptHTML + '<span class="t-user" id="u1"></span><span class="t-ghost" id="g1"></span><span class="t-cursor"></span>');
    const u1 = l1.querySelector("#u1");
    const g1 = l1.querySelector("#g1");
    await typeInto(u1, "npm te");
    g1.textContent = "st -- --watch";
    await sleep(reduced ? 0 : 900);

    // Frame 2: user switches to AI mode
    l1.querySelector(".t-cursor")?.remove();
    g1.remove();
    u1.textContent = "fix the failing auth test";
    line('<span class="t-banner">AI mode · Shift+Tab</span>');
    await sleep(reduced ? 0 : 500);

    // Frame 3: Claude proposes a command with approval hints
    line('<span class="t-ai">claude ›</span> <span class="t-dim">I see one failing test in</span> <span class="t-user">tests/auth.test.ts</span><span class="t-dim">. Suggested:</span>');
    line('  <span class="t-prompt">$</span> <span class="t-user">npm test -- --workspace=app tests/auth.test.ts</span>');
    const hints = line('  <span class="t-dim"><span class="t-kbd">Enter</span> approve  <span class="t-kbd">E</span> edit  <span class="t-kbd">Esc</span> reject</span>');
    await sleep(reduced ? 0 : 1100);

    // Frame 4: approve and stream output
    hints.innerHTML = '  <span class="t-ok">✓ approved</span>';
    await sleep(reduced ? 0 : 250);
    line('<span class="t-dim">› running...</span>');
    await sleep(reduced ? 0 : 250);
    line('<span class="t-ok">PASS</span> tests/auth.test.ts');
    line('  <span class="t-ok">✓</span> rejects invalid token <span class="t-dim">(12ms)</span>');
    line('  <span class="t-ok">✓</span> refreshes on expiry <span class="t-dim">(8ms)</span>');
    line('<span class="t-dim">Tests: 2 passed · Time: 0.4s</span>');
    line(promptHTML + '<span class="t-cursor"></span>');

    await sleep(reduced ? 5000 : 4200);
  }

  async function loop() {
    while (true) {
      await frame();
      if (reduced) await sleep(8000);
    }
  }
  loop();
}
```

- [ ] **Step 3: Reload the page and watch the hero terminal**

Expected: terminal types `npm te`, ghost-text `st -- --watch` fades in, user message changes to `fix the failing auth test`, an "AI MODE" pill appears, Claude proposes a command, approval keys show, then test output streams. Loop repeats.

- [ ] **Step 4: Toggle reduced motion (Chrome DevTools → Rendering → Emulate CSS prefers-reduced-motion: reduce) and reload**

Expected: frames swap nearly instantly; no character-by-character typing; loop still cycles but at a slower pace.

- [ ] **Step 5: Commit**

```bash
git add docs/styles.css docs/script.js
git commit -m "feat(site): animate hero terminal demo"
```

---

## Task 5: Feature grid

**Files:**
- Modify: `docs/index.html` (append features section)
- Modify: `docs/styles.css` (feature card styles)

- [ ] **Step 1: Append features section inside `<main>`, after hero**

```html
<section id="features" class="section">
  <div class="container">
    <header class="section__header">
      <span class="eyebrow">Features</span>
      <h2 class="section__title">Built for the way you actually work.</h2>
      <p class="section__sub">Six things that disappear into your flow once you have them.</p>
    </header>
    <div class="features">
      <article class="card">
        <div class="card__icon" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z"/></svg>
        </div>
        <h3>Natural language, right in the prompt</h3>
        <p>Start typing — TAI auto-detects shell vs. question. Shell runs. Questions go to Claude. <kbd>Shift</kbd>+<kbd>Tab</kbd> overrides.</p>
      </article>
      <article class="card">
        <div class="card__icon" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m9 12 2 2 4-4"/><circle cx="12" cy="12" r="10"/></svg>
        </div>
        <h3>Suggestions you approve</h3>
        <p>Every AI command shows before it runs. <kbd>Enter</kbd> to approve, <kbd>E</kbd> to edit, <kbd>Esc</kbd> to reject. Configurable trust levels.</p>
      </article>
      <article class="card">
        <div class="card__icon" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 14 0"/><path d="m13 5 7 7-7 7"/></svg>
        </div>
        <h3>Ghost-text predictions</h3>
        <p>TAI learns your shell history and predicts as you type. <kbd>Tab</kbd> or <kbd>→</kbd> accepts. Cycling tab-completion popup included.</p>
      </article>
      <article class="card">
        <div class="card__icon" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="6" rx="2"/><rect x="3" y="14" width="18" height="6" rx="2"/></svg>
        </div>
        <h3>Block-based output</h3>
        <p>Commands and output become discrete blocks with timing, collapsing, ANSI color, and Markdown-rendered AI replies with copy-to-clipboard code.</p>
      </article>
      <article class="card">
        <div class="card__icon" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h12a2 2 0 0 1 2 2v2"/><path d="M4 4v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6"/><path d="M22 10v6"/><path d="M16 10h6"/></svg>
        </div>
        <h3>Multi-tab sessions</h3>
        <p>Open multiple terminals as tabs — each with its own working directory, context, and trust level. <kbd>Ctrl</kbd>+<kbd>1-9</kbd> to jump.</p>
      </article>
      <article class="card">
        <div class="card__icon" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/></svg>
        </div>
        <h3>System tray</h3>
        <p>Close the window — TAI keeps running. Click the tray icon to bring it back. Tray icon adapts to your system theme on Mac and Windows.</p>
      </article>
    </div>
  </div>
</section>
```

- [ ] **Step 2: Append section + card styles to `docs/styles.css`**

```css
.section { padding: 96px 0; position: relative; }
.section__header { text-align: center; max-width: 640px; margin: 0 auto 56px; }
.section__title {
  font-size: clamp(28px, 4vw, 44px);
  font-weight: 700;
  letter-spacing: -0.02em;
  margin: 14px 0 14px;
  line-height: 1.12;
}
.section__sub { color: var(--text-muted); font-size: 17px; margin: 0; }

.features {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 18px;
}
.card {
  position: relative;
  background: linear-gradient(180deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 28px 24px;
  backdrop-filter: blur(8px);
  transition: transform 0.18s ease, border-color 0.18s ease, background 0.18s ease;
}
.card:hover {
  transform: translateY(-3px);
  border-color: var(--border-strong);
  background: linear-gradient(180deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%);
}
.card__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: rgba(0, 168, 132, 0.12);
  color: var(--accent);
  margin-bottom: 18px;
  border: 1px solid rgba(0, 168, 132, 0.22);
}
.card h3 {
  margin: 0 0 8px;
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.card p { margin: 0; color: var(--text-muted); font-size: 14.5px; line-height: 1.6; }
.card kbd {
  font-family: var(--font-mono);
  font-size: 11px;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(255,255,255,0.06);
  border: 1px solid var(--border-strong);
  color: var(--text);
}

@media (max-width: 980px) {
  .features { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 600px) {
  .section { padding: 64px 0; }
  .features { grid-template-columns: 1fr; }
}
```

- [ ] **Step 3: Reload and confirm the 3-column grid renders on desktop, 2-col at tablet, 1-col at mobile.**

- [ ] **Step 4: Commit**

```bash
git add docs/index.html docs/styles.css
git commit -m "feat(site): add features grid"
```

---

## Task 6: Screenshot showcase

**Files:**
- Modify: `docs/index.html` (append section)
- Modify: `docs/styles.css` (showcase styles)

- [ ] **Step 1: Append showcase section after the features section**

```html
<section class="section section--alt">
  <div class="container">
    <header class="section__header">
      <span class="eyebrow">In action</span>
      <h2 class="section__title">A terminal that shows its work.</h2>
      <p class="section__sub">Block-based output for shell commands. Markdown for AI. Both, side by side.</p>
    </header>
    <div class="shots">
      <figure class="shot">
        <img src="screenshots/terminal.png" alt="TAI showing block-based command output with colorized ls and git log" loading="lazy" />
        <figcaption>Shell mode — block output, ANSI colors, timing.</figcaption>
      </figure>
      <figure class="shot">
        <img src="screenshots/ai-mode.png" alt="TAI in AI mode with a natural language prompt ready for Claude" loading="lazy" />
        <figcaption>AI mode — natural language, Markdown answers, syntax-highlighted code.</figcaption>
      </figure>
    </div>
  </div>
</section>
```

- [ ] **Step 2: Append showcase styles to `docs/styles.css`**

```css
.section--alt {
  background:
    radial-gradient(50% 60% at 50% 0%, rgba(139, 92, 246, 0.10), transparent 70%),
    var(--bg);
}
.shots {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
}
.shot {
  margin: 0;
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-lg);
  overflow: hidden;
  box-shadow: var(--shadow-lg);
}
.shot img { width: 100%; height: auto; display: block; }
.shot figcaption {
  padding: 14px 18px;
  color: var(--text-muted);
  font-size: 13.5px;
  border-top: 1px solid var(--border);
  background: rgba(255,255,255,0.02);
}
@media (max-width: 820px) {
  .shots { grid-template-columns: 1fr; }
}
```

- [ ] **Step 3: Reload — confirm both screenshots display with captions and shadows; stack on mobile.**

- [ ] **Step 4: Commit**

```bash
git add docs/index.html docs/styles.css
git commit -m "feat(site): add screenshot showcase"
```

---

## Task 7: Keyboard shortcuts grid

**Files:**
- Modify: `docs/index.html` (append shortcuts section)
- Modify: `docs/styles.css` (shortcut styles)

- [ ] **Step 1: Append shortcuts section after the showcase**

```html
<section id="shortcuts" class="section">
  <div class="container">
    <header class="section__header">
      <span class="eyebrow">Keyboard-first</span>
      <h2 class="section__title">Shortcuts for everything.</h2>
      <p class="section__sub">Mouse optional. The whole product is reachable from the home row.</p>
    </header>
    <div class="shortcuts">
      <div class="shortcut"><span class="shortcut__keys"><kbd>Shift</kbd><kbd>Tab</kbd></span><span>Toggle shell / AI mode</span></div>
      <div class="shortcut"><span class="shortcut__keys"><kbd>Tab</kbd></span><span>Accept ghost text or cycle completions</span></div>
      <div class="shortcut"><span class="shortcut__keys"><kbd>→</kbd></span><span>Accept ghost-text prediction</span></div>
      <div class="shortcut"><span class="shortcut__keys"><kbd>↑</kbd><kbd>↓</kbd></span><span>Navigate command history</span></div>
      <div class="shortcut"><span class="shortcut__keys"><kbd>Ctrl</kbd><kbd>L</kbd></span><span>Clear screen</span></div>
      <div class="shortcut"><span class="shortcut__keys"><kbd>Ctrl</kbd><kbd>U</kbd></span><span>Clear line before cursor</span></div>
      <div class="shortcut"><span class="shortcut__keys"><kbd>Ctrl</kbd><kbd>W</kbd></span><span>Delete word before cursor</span></div>
      <div class="shortcut"><span class="shortcut__keys"><kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>T</kbd></span><span>New tab</span></div>
      <div class="shortcut"><span class="shortcut__keys"><kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>W</kbd></span><span>Close tab</span></div>
      <div class="shortcut"><span class="shortcut__keys"><kbd>Ctrl</kbd><kbd>1-9</kbd></span><span>Switch to tab N</span></div>
      <div class="shortcut"><span class="shortcut__keys"><kbd>Ctrl</kbd><kbd>Tab</kbd></span><span>Next tab</span></div>
      <div class="shortcut"><span class="shortcut__keys"><kbd>Ctrl</kbd><kbd>,</kbd></span><span>Settings</span></div>
      <div class="shortcut"><span class="shortcut__keys"><kbd>Enter</kbd></span><span>Approve AI suggestion</span></div>
      <div class="shortcut"><span class="shortcut__keys"><kbd>E</kbd></span><span>Edit AI suggestion</span></div>
      <div class="shortcut"><span class="shortcut__keys"><kbd>Esc</kbd></span><span>Reject AI suggestion</span></div>
    </div>
  </div>
</section>
```

- [ ] **Step 2: Append shortcut styles to `docs/styles.css`**

```css
.shortcuts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px 18px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 24px;
}
.shortcut {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 6px;
  border-bottom: 1px dashed var(--border);
  color: var(--text-muted);
  font-size: 14px;
}
.shortcut:nth-last-child(-n+3) { border-bottom: 0; }
.shortcut__keys {
  display: inline-flex;
  gap: 4px;
  flex-shrink: 0;
}
.shortcut kbd {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 500;
  padding: 3px 7px;
  border-radius: 5px;
  background: rgba(255,255,255,0.05);
  border: 1px solid var(--border-strong);
  border-bottom-width: 2px;
  color: var(--text);
  min-width: 24px;
  text-align: center;
}
@media (max-width: 900px) {
  .shortcuts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .shortcut:nth-last-child(-n+3) { border-bottom: 1px dashed var(--border); }
  .shortcut:nth-last-child(-n+2) { border-bottom: 0; }
}
@media (max-width: 560px) {
  .shortcuts { grid-template-columns: 1fr; padding: 16px; }
  .shortcut { border-bottom: 1px dashed var(--border); }
  .shortcut:last-child { border-bottom: 0; }
}
```

- [ ] **Step 3: Reload and confirm the grid renders 3-col on desktop, 2-col at tablet, 1-col on mobile. Keys look like physical key caps.**

- [ ] **Step 4: Commit**

```bash
git add docs/index.html docs/styles.css
git commit -m "feat(site): add keyboard shortcuts grid"
```

---

## Task 8: Quick start with copy buttons

**Files:**
- Modify: `docs/index.html` (append install section)
- Modify: `docs/styles.css` (code block styles)
- Modify: `docs/script.js` (copy-button wiring)

- [ ] **Step 1: Append install section after shortcuts**

```html
<section id="install" class="section section--alt">
  <div class="container">
    <header class="section__header">
      <span class="eyebrow">Quick start</span>
      <h2 class="section__title">Up and running in a minute.</h2>
      <p class="section__sub">Grab the AppImage, or build from source. TAI uses the Claude CLI as its AI backend — install it first.</p>
    </header>
    <div class="install">
      <div class="install__col">
        <h3 class="install__title">Download</h3>
        <p class="install__lede">Latest AppImage for Linux:</p>
        <div class="codeblock">
          <pre><code>curl -L https://github.com/darkharasho/tai/releases/latest \
  -o tai.AppImage
chmod +x tai.AppImage
./tai.AppImage</code></pre>
          <button class="copy" type="button" aria-label="Copy install command">Copy</button>
        </div>
        <p class="install__note">First, install the <a href="https://docs.anthropic.com/en/docs/claude-code">Claude CLI</a> and authenticate it.</p>
      </div>
      <div class="install__col">
        <h3 class="install__title">Build from source</h3>
        <p class="install__lede">Node 20+ recommended.</p>
        <div class="codeblock">
          <pre><code>git clone https://github.com/darkharasho/tai.git
cd tai
npm install
npm run dev      # development
npm run dist     # build distributable</code></pre>
          <button class="copy" type="button" aria-label="Copy build command">Copy</button>
        </div>
        <p class="install__note">Releases are built and signed in CI on every tag.</p>
      </div>
    </div>
  </div>
</section>
```

- [ ] **Step 2: Append install/codeblock styles to `docs/styles.css`**

```css
.install {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 24px;
}
.install__col {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 28px;
}
.install__title {
  margin: 0 0 6px;
  font-size: 18px;
  font-weight: 600;
}
.install__lede { margin: 0 0 16px; color: var(--text-muted); font-size: 14.5px; }
.install__note { margin: 14px 0 0; color: var(--text-dim); font-size: 13px; }
.install__note a { color: var(--accent); text-decoration: underline; text-underline-offset: 3px; }

.codeblock {
  position: relative;
  background: #0c0c12;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}
.codeblock pre {
  margin: 0;
  padding: 18px 56px 18px 18px;
  overflow-x: auto;
  font-family: var(--font-mono);
  font-size: 13.5px;
  line-height: 1.6;
  color: #d6d6e0;
}
.copy {
  position: absolute;
  top: 10px;
  right: 10px;
  padding: 5px 10px;
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
  background: rgba(255,255,255,0.04);
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  transition: color 0.15s ease, background 0.15s ease, border-color 0.15s ease;
}
.copy:hover { color: var(--text); background: rgba(255,255,255,0.08); }
.copy.is-copied { color: var(--accent); border-color: var(--accent); }

@media (max-width: 820px) {
  .install { grid-template-columns: 1fr; }
  .install__col { padding: 22px; }
}
```

- [ ] **Step 3: Append copy-button wiring inside the `DOMContentLoaded` handler in `docs/script.js`**

```js
document.querySelectorAll(".copy").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const code = btn.parentElement.querySelector("code");
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code.textContent.trim());
      const orig = btn.textContent;
      btn.textContent = "Copied";
      btn.classList.add("is-copied");
      setTimeout(() => {
        btn.textContent = orig;
        btn.classList.remove("is-copied");
      }, 1600);
    } catch {
      btn.textContent = "Press Ctrl+C";
      setTimeout(() => (btn.textContent = "Copy"), 1600);
    }
  });
});
```

- [ ] **Step 4: Reload and click each Copy button.**

Expected: button label flips to "Copied" in accent color for ~1.6s, clipboard contains the code text.

- [ ] **Step 5: Commit**

```bash
git add docs/index.html docs/styles.css docs/script.js
git commit -m "feat(site): add quick start with copy buttons"
```

---

## Task 9: Footer + scroll-fade animation

**Files:**
- Modify: `docs/index.html` (fill `<footer>`)
- Modify: `docs/styles.css` (footer styles + fade-up)
- Modify: `docs/script.js` (IntersectionObserver)

- [ ] **Step 1: Fill the `<footer id="footer">` element**

```html
<footer id="footer" class="footer">
  <div class="container footer__inner">
    <div class="footer__brand">
      <img src="favicon.png" alt="" width="22" height="22" />
      <span>TAI</span>
    </div>
    <p class="footer__tagline">Built for developers who think in terminals.</p>
    <nav class="footer__links" aria-label="Footer">
      <a href="https://github.com/darkharasho/tai">GitHub</a>
      <a href="https://github.com/darkharasho/tai/releases">Releases</a>
      <a href="https://github.com/darkharasho/tai/blob/main/LICENSE">License</a>
    </nav>
  </div>
</footer>
```

- [ ] **Step 2: Append footer + fade-up styles to `docs/styles.css`**

```css
.footer {
  border-top: 1px solid var(--border);
  padding: 36px 0 56px;
  margin-top: 40px;
  background: rgba(255,255,255,0.01);
}
.footer__inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.footer__brand {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-weight: 700;
}
.footer__tagline { margin: 0; color: var(--text-dim); font-size: 13.5px; }
.footer__links { display: flex; gap: 20px; }
.footer__links a { color: var(--text-muted); font-size: 14px; }
.footer__links a:hover { color: var(--text); }

.reveal {
  opacity: 0;
  transform: translateY(14px);
  transition: opacity 0.5s ease, transform 0.5s ease;
}
.reveal.is-visible {
  opacity: 1;
  transform: translateY(0);
}
@media (prefers-reduced-motion: reduce) {
  .reveal { opacity: 1; transform: none; transition: none; }
}
```

- [ ] **Step 3: Mark each top-level section as `.reveal` in `docs/index.html`**

Add the `reveal` class to each `<section>` element (hero, features, showcase, shortcuts, install). Example: `<section id="features" class="section reveal">`. Leave the hero un-revealed if you prefer it visible on load — your call. (Recommended: skip `.reveal` on `.hero` since it's above the fold.)

- [ ] **Step 4: Wire the IntersectionObserver in `docs/script.js`**

Append inside `DOMContentLoaded`:

```js
const reveals = document.querySelectorAll(".reveal");
if (reveals.length && "IntersectionObserver" in window) {
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        io.unobserve(entry.target);
      }
    }
  }, { rootMargin: "0px 0px -10% 0px", threshold: 0.05 });
  reveals.forEach((el) => io.observe(el));
} else {
  reveals.forEach((el) => el.classList.add("is-visible"));
}
```

- [ ] **Step 5: Reload and scroll the page**

Expected: each section fades up as it enters the viewport. Enable `prefers-reduced-motion` and verify sections appear instantly with no transition.

- [ ] **Step 6: Commit**

```bash
git add docs/index.html docs/styles.css docs/script.js
git commit -m "feat(site): add footer and scroll-fade reveal"
```

---

## Task 10: Cross-browser + responsive QA + Lighthouse

**Files:** none (verification only, fix-forward if issues found)

- [ ] **Step 1: Manual viewport check**

Open `docs/index.html` in Chrome. Use DevTools device toolbar to test these viewports:
- 1440 × 900 (desktop)
- 1024 × 768 (small laptop)
- 768 × 1024 (tablet)
- 375 × 812 (mobile)

For each: confirm no horizontal scroll, nav collapses correctly at mobile, sections stack properly, terminal animation still readable.

- [ ] **Step 2: Lighthouse audit**

DevTools → Lighthouse → Desktop → Performance + Accessibility + Best Practices + SEO → Analyze.

Expected: Performance ≥ 90, Accessibility ≥ 95, Best Practices ≥ 95, SEO ≥ 90.

If any fail, fix the specific issues reported (most common: missing `alt`, low color contrast on `--text-dim` text, missing `lang` on html — all already handled in the spec, but verify).

- [ ] **Step 3: Firefox visual sanity check**

Open in Firefox. Confirm `backdrop-filter` still degrades acceptably (nav remains legible even if blur is unsupported), terminal animation plays, copy buttons work.

- [ ] **Step 4: Commit any fixes (if any were needed)**

```bash
git add -p
git commit -m "fix(site): QA pass tweaks"
```

If no fixes needed, skip this step.

---

## Task 11: Enable GitHub Pages publishing

**Files:** none (repo setting change)

- [ ] **Step 1: Push all marketing-page commits to `main`**

```bash
git push origin main
```

- [ ] **Step 2: Configure GitHub Pages**

In a browser, go to `https://github.com/darkharasho/tai/settings/pages`. Set:
- **Source:** Deploy from a branch
- **Branch:** `main`
- **Folder:** `/docs`

Click Save.

- [ ] **Step 3: Wait ~1 minute, then verify the live deploy**

Open `https://darkharasho.github.io/tai/` in a browser.

Expected: full marketing page renders, terminal animation runs, screenshots load, copy buttons work, links to GitHub release/repo work.

If the page 404s, recheck the Pages settings (branch must be `main`, folder must be `/docs`, and there must be at least one commit on `main` containing `docs/index.html`).

- [ ] **Step 4: Add a Pages badge / link to the project README**

Edit `README.md` — find the badges block near the top and add a Website badge as the first item:

```html
<a href="https://darkharasho.github.io/tai/"><img src="https://img.shields.io/badge/website-darkharasho.github.io%2Ftai-00a884?style=flat-square" alt="Website" /></a>
```

- [ ] **Step 5: Commit and push the README change**

```bash
git add README.md
git commit -m "docs: link marketing site from README"
git push origin main
```

- [ ] **Step 6: Confirm auto-publish**

After the push completes, the Pages action runs automatically. Visit `https://github.com/darkharasho/tai/actions` and confirm the `pages build and deployment` workflow shows green. Reload the live site and confirm the badge change is reflected if you visit the README on GitHub.

---

## Spec coverage summary

- Hosting from `main:/docs`, auto-publish, no Actions — Task 11.
- Single static `index.html` + `styles.css` + `script.js`, no build — Task 1.
- Favicon from `public/img/tai.png` — Task 1.
- Hybrid visual direction (gradient marketing + animated terminal hero) — Tasks 3, 4.
- Sticky nav with mobile menu — Task 2.
- Hero (headline, CTAs, animated terminal) — Tasks 3, 4.
- Feature grid (6 cards) — Task 5.
- Screenshot showcase — Task 6.
- Keyboard shortcuts grid — Task 7.
- Quick start with copy buttons — Task 8.
- Footer — Task 9.
- Scroll-fade animations + `prefers-reduced-motion` handling — Task 9 (and Task 4 for terminal).
- Accessibility (skip link, semantic landmarks, focus rings, alt text, contrast) — Tasks 1, 3, 6, 10.
- Lighthouse ≥ 90 perf / ≥ 95 a11y — Task 10.
- README link to live site — Task 11.

No placeholders, no TBDs. Type / property names consistent across tasks (`.reveal`, `.is-visible`, `.copy`, `.is-copied`, `#demo-body`, `.terminal__*`).
