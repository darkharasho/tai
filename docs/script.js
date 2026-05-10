// Marketing page interactions. Sections wire themselves up after DOMContentLoaded.
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

  const body = document.getElementById("demo-body");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const input = document.getElementById("demo-input");
  if (body && input) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    const prompt = (cmd = "") =>
      '<span class="t-user-name">alex</span>' +
      '<span class="t-host">@fedora</span> ' +
      '<span class="t-path">~/projects/tai</span> ' +
      '<span class="t-dollar">$</span>' +
      (cmd ? ' <span class="t-user">' + cmd + '</span>' : '');

    async function typeInto(el, text, speed = 30) {
      for (const ch of text) {
        el.textContent += ch;
        if (!reduced) await sleep(speed + Math.random() * 30);
      }
    }

    function scrollBottom() { body.scrollTop = body.scrollHeight; }

    function makeBlock(variant = "") {
      const div = document.createElement("div");
      div.className = "t-block" + (variant ? " t-block--" + variant : "");
      body.appendChild(div);
      return div;
    }

    function shellBlock({ cmd, dur = "0.1s", output = "" }) {
      const div = makeBlock();
      div.innerHTML =
        `<div class="t-block__header">` +
          `<span class="t-pulse"></span>` +
          `<span class="t-block__cmd">${prompt(cmd)}</span>` +
          `<span class="t-duration">${dur}</span>` +
        `</div>` +
        `<div class="t-block__sep"></div>` +
        (output ? `<div class="t-block__body">${output}</div>` : "");
      scrollBottom();
      return div;
    }

    function claudeBlock() {
      const div = makeBlock("ai");
      div.innerHTML =
        `<div class="t-block__header">` +
          `<span class="t-ai-name">Claude</span>` +
          `<span class="t-stream-dot"></span>` +
        `</div>` +
        `<div class="t-block__sep"></div>` +
        `<div class="t-md" id="claude-md"></div>`;
      scrollBottom();
      return div;
    }

    function suggestBlock(command) {
      const div = makeBlock("suggest");
      div.innerHTML =
        `<div class="t-block__header">` +
          `<span class="t-ai-name t-ai-name--agent">Approve to run</span>` +
        `</div>` +
        `<div class="t-cmd-preview"><span class="t-cmd-preview__accent">❯</span>${command}</div>` +
        `<div class="t-actions">` +
          `<button class="t-btn"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>Edit<span class="t-btn-hint">(e)</span></button>` +
          `<button class="t-btn t-btn--approve"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>Approve<span class="t-btn-hint">(↵)</span></button>` +
          `<button class="t-btn t-btn--reject"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>Reject<span class="t-btn-hint">(esc)</span></button>` +
        `</div>`;
      scrollBottom();
      return div;
    }

    const toolIcons = {
      Read: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
      Grep: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
      Bash: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>',
      Edit: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>',
    };
    const okSVG = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

    function addTool(parent, { name, label }) {
      const div = document.createElement("div");
      div.className = "t-tool is-active";
      div.innerHTML =
        `<span class="t-tool__chevron"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></span>` +
        `<span class="t-tool__icon">${toolIcons[name] || toolIcons.Bash}</span>` +
        `<span class="t-tool__name">${name}</span>` +
        `<span class="t-tool__label">${label}</span>` +
        `<span class="t-tool__status"><span class="t-tool__spin"></span></span>`;
      parent.appendChild(div);
      scrollBottom();
      return div;
    }
    function finishTool(toolEl) {
      toolEl.classList.remove("is-active");
      const status = toolEl.querySelector(".t-tool__status");
      if (status) status.innerHTML = `<span class="t-tool__status--ok">${okSVG}</span>`;
    }

    function questionRow(text) {
      const div = document.createElement("div");
      div.className = "t-question";
      div.innerHTML =
        `<span class="t-question__icon"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.5L19 10l-5.1 1.5L12 17l-1.9-5.5L5 10l5.1-1.5z"/><path d="M19 3v3"/><path d="M21 4.5h-3"/></svg></span>` +
        `<span class="t-question__text">${text}</span>`;
      body.appendChild(div);
      scrollBottom();
      return div;
    }

    const tab = document.getElementById("demo-tab");
    const tabBadge = document.getElementById("demo-tab-badge");
    const tabMode = document.getElementById("demo-tab-mode");
    const chevronSVG = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>';
    const sparkleSVG = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.5L19 10l-5.1 1.5L12 17l-1.9-5.5L5 10l5.1-1.5z"/><path d="M19 3v3"/><path d="M21 4.5h-3"/></svg>';
    function setTabMode(mode) {
      if (!tab) return;
      if (mode === "ai") {
        tab.classList.add("is-ai");
        if (tabBadge) tabBadge.innerHTML = sparkleSVG + '<span>AI</span>';
      } else {
        tab.classList.remove("is-ai");
        if (tabBadge) tabBadge.innerHTML = chevronSVG + '<span>Terminal</span>';
      }
    }

    function addHistory() {
      shellBlock({
        cmd: "cat package.json | head -6",
        dur: "0.1s",
        output:
          '<div>{</div>' +
          '<div>  <span class="t-key">"name"</span>: <span class="t-str">"tai"</span>,</div>' +
          '<div>  <span class="t-key">"version"</span>: <span class="t-str">"1.2.3"</span>,</div>' +
          '<div>  <span class="t-key">"description"</span>: <span class="t-str">"An AI-native terminal that understands what you\'re doing."</span>,</div>' +
          '<div>  <span class="t-key">"main"</span>: <span class="t-str">"dist-electron/main.js"</span>,</div>' +
          '<div>  <span class="t-key">"scripts"</span>: {</div>',
      });
      shellBlock({
        cmd: 'ls --color=auto src/',
        dur: "0.1s",
        output:
          '<div><span style="color:#bec6d0">App.tsx</span>  <span style="color:#11B7D4">components</span>  <span style="color:#11B7D4">hooks</span>  <span style="color:#bec6d0">main.tsx</span>  <span style="color:#11B7D4">providers</span>  <span style="color:#11B7D4">styles</span>  <span style="color:#11B7D4">types</span>  <span style="color:#bec6d0">types.ts</span>  <span style="color:#11B7D4">utils</span></div>',
      });
    }

    const shieldCheckSVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>';

    function renderInput({ mode = "shell", text = "", ghost = "", showCursor = true, focused = true }) {
      setTabMode(mode);
      input.className = "terminal__input-row" + (focused ? " is-focused" : "") + (mode === "ai" ? " is-ai" : "");
      const promptHTML = mode === "ai"
        ? '<span class="t-sparkle" style="font-size:14px">✦</span> <span class="t-path t-path--input">~/projects/tai</span> '
        : '<span class="t-user-name">alex</span><span class="t-host">@fedora</span> <span class="t-path t-path--input">~/projects/tai</span> <span class="t-dollar">$</span> ';
      const modeLabel = mode === "ai" ? "AI" : "Shell";
      input.innerHTML =
        '<span class="terminal__perm-pill" tabindex="-1">' + shieldCheckSVG + 'Default</span>' +
        '<div class="terminal__input-text">' +
          promptHTML +
          '<span class="t-user" id="in-text">' + text + '</span>' +
          (ghost ? '<span class="t-ghost" id="in-ghost">' + ghost + '</span>' : '') +
          (showCursor ? '<span class="t-cursor"></span>' : '') +
        '</div>' +
        '<span class="terminal__mode-kbd">Shift+Tab</span>' +
        '<span class="terminal__mode-label">' + modeLabel + '</span>';
      return {
        textEl: input.querySelector("#in-text"),
        ghostEl: input.querySelector("#in-ghost"),
        cursor: input.querySelector(".t-cursor"),
      };
    }

    async function frame() {
      body.innerHTML = "";
      addHistory();

      // Frame 1: ghost-text prediction in shell mode
      let ui = renderInput({ mode: "shell", text: "", ghost: "" });
      await typeInto(ui.textEl, "npm te");
      renderInput({ mode: "shell", text: "npm te", ghost: "st -- --watch" });
      await sleep(reduced ? 0 : 900);

      // Frame 2: switch to AI mode, type a question
      ui = renderInput({ mode: "ai", text: "", ghost: "" });
      await typeInto(ui.textEl, "fix the failing auth test", 28);
      await sleep(reduced ? 0 : 500);

      // Frame 3: question echoes as a row, Claude streams a markdown response
      const question = "fix the failing auth test";
      renderInput({ mode: "ai", text: "", ghost: "" });
      questionRow(question);
      const claude = claudeBlock();
      const md = claude.querySelector("#claude-md");

      // First paragraph
      const p1 = document.createElement("p");
      p1.innerHTML = 'Let me check what\'s happening in <code>tests/auth.test.ts</code>.';
      md.appendChild(p1);
      scrollBottom();
      await sleep(reduced ? 0 : 500);

      // Tool calls stream one at a time
      const t1 = addTool(md, { name: "Read", label: "tests/auth.test.ts" });
      await sleep(reduced ? 0 : 700);
      finishTool(t1);
      await sleep(reduced ? 0 : 300);

      const t2 = addTool(md, { name: "Grep", label: '"Date.now" · src/auth' });
      await sleep(reduced ? 0 : 650);
      finishTool(t2);
      await sleep(reduced ? 0 : 300);

      const t3 = addTool(md, { name: "Read", label: "src/auth/token.ts" });
      await sleep(reduced ? 0 : 550);
      finishTool(t3);
      await sleep(reduced ? 0 : 400);

      const paragraphs = [
        '<p>Found two likely culprits:</p>',
        '<ul>' +
          '<li>The token refresh path compares against <code>Date.now()</code> in seconds rather than ms.</li>' +
          '<li>The mock <strong>jwt.verify</strong> isn\'t restored between cases, so state bleeds across tests.</li>' +
        '</ul>',
        '<p>Want me to run it scoped first so we can confirm before patching?</p>',
      ];
      for (const p of paragraphs) {
        const tmp = document.createElement("div");
        tmp.innerHTML = p;
        while (tmp.firstChild) md.appendChild(tmp.firstChild);
        scrollBottom();
        await sleep(reduced ? 0 : 500);
      }
      claude.querySelector(".t-stream-dot")?.remove();
      const dur = document.createElement("span");
      dur.className = "t-duration";
      dur.textContent = "1.4s";
      claude.querySelector(".t-block__header").appendChild(dur);
      await sleep(reduced ? 0 : 350);

      // Frame 4: suggestion block with Approve/Edit/Reject
      const suggest = suggestBlock("npm test -- --workspace=app tests/auth.test.ts");
      await sleep(reduced ? 0 : 1500);

      // Frame 5: approved → shell block with PASS output, return to shell mode
      suggest.remove();
      shellBlock({
        cmd: "npm test -- --workspace=app tests/auth.test.ts",
        dur: "0.4s",
        output:
          '<div><span class="t-ok">PASS</span> tests/auth.test.ts</div>' +
          '<div>  <span class="t-ok">✓</span> rejects invalid token <span class="t-dim">(12ms)</span></div>' +
          '<div>  <span class="t-ok">✓</span> refreshes on expiry <span class="t-dim">(8ms)</span></div>' +
          '<div class="t-dim" style="margin-top:6px">Tests: 2 passed · Time: 0.4s</div>',
      });
      renderInput({ mode: "shell", text: "", ghost: "" });

      await sleep(reduced ? 5000 : 4500);
    }

    async function loop() {
      while (true) {
        await frame();
        if (reduced) await sleep(8000);
      }
    }
    loop();
  }

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
});
