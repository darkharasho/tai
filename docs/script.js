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

    async function typeInto(el, text, speed = 32) {
      for (const ch of text) {
        el.textContent += ch;
        if (!reduced) await sleep(speed + Math.random() * 30);
      }
    }

    function scrollBottom() { body.scrollTop = body.scrollHeight; }

    function block({ cmd, dur = "0.1s", output = "", variant = "", aiName = "", actions = false }) {
      const div = document.createElement("div");
      div.className = "t-block" + (variant ? " t-block--" + variant : "");
      const pulseClass = variant === "ai" ? "t-pulse t-pulse--ai" : variant === "suggest" ? "t-pulse t-pulse--orange" : "t-pulse";
      const durHTML = dur ? `<span class="t-duration">${dur}</span>` : "";
      const header = aiName
        ? `<div class="t-block__header"><span class="${pulseClass}"></span><span class="t-ai-name">${aiName}</span>${durHTML}</div>`
        : `<div class="t-block__header"><span class="t-block__cmd">${prompt(cmd)}</span>${durHTML}</div>`;
      let bodyHTML = output ? `<div class="t-block__body">${output}</div>` : "";
      if (actions) {
        bodyHTML += `<div class="t-block__body" style="padding-top:0"><div class="t-actions"><span class="t-approve">Enter · approve</span><span class="t-edit">E · edit</span><span class="t-reject">Esc · reject</span></div></div>`;
      }
      div.innerHTML = header + bodyHTML;
      body.appendChild(div);
      scrollBottom();
      return div;
    }

    const tab = document.getElementById("demo-tab");
    const tabIcon = document.getElementById("demo-tab-icon");
    const chevronSVG = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>';
    const sparkleSVG = '<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.6 5.4L19 9l-5.4 1.6L12 16l-1.6-5.4L5 9l5.4-1.6z"/></svg>';
    function setTabMode(mode) {
      if (!tab) return;
      if (mode === "ai") {
        tab.classList.add("is-ai");
        if (tabIcon) tabIcon.innerHTML = sparkleSVG;
      } else {
        tab.classList.remove("is-ai");
        if (tabIcon) tabIcon.innerHTML = chevronSVG;
      }
    }

    function addHistory() {
      block({
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
      block({
        cmd: 'ls --color=auto src/',
        dur: "0.1s",
        output:
          '<div><span style="color:#bec6d0">App.tsx</span>  <span style="color:#11B7D4">components</span>  <span style="color:#11B7D4">hooks</span>  <span style="color:#bec6d0">main.tsx</span>  <span style="color:#11B7D4">providers</span>  <span style="color:#11B7D4">styles</span>  <span style="color:#11B7D4">types</span>  <span style="color:#bec6d0">types.ts</span>  <span style="color:#11B7D4">utils</span></div>',
      });
    }

    function renderInput({ mode = "shell", text = "", ghost = "", showCursor = true, focused = true }) {
      setTabMode(mode);
      input.className = "terminal__input-row" + (focused ? " is-focused" : "") + (mode === "ai" ? " is-ai" : "");
      const promptHTML = mode === "ai"
        ? '<span class="t-sparkle">✦</span> <span class="t-path">~/projects/tai</span> '
        : prompt() + ' ';
      const modeLabel = mode === "ai" ? "AI" : "Shell";
      const modeClass = mode === "ai" ? "terminal__mode-pill is-ai" : "terminal__mode-pill";
      input.innerHTML =
        '<div class="terminal__input-text">' +
          promptHTML +
          '<span class="t-user" id="in-text">' + text + '</span>' +
          (ghost ? '<span class="t-ghost" id="in-ghost">' + ghost + '</span>' : '') +
          (showCursor ? '<span class="t-cursor"></span>' : '') +
        '</div>' +
        '<span class="terminal__default-pill"><span class="terminal__default-dot"></span>Default</span>' +
        '<span class="terminal__mode-key">Shift+Tab</span>' +
        '<span class="' + modeClass + '">' + modeLabel + '</span>';
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
      let ui = renderInput({ mode: "shell", text: "", ghost: "", showCursor: true });
      await typeInto(ui.textEl, "npm te");
      ui = renderInput({ mode: "shell", text: "npm te", ghost: "st -- --watch", showCursor: true });
      await sleep(reduced ? 0 : 900);

      // Frame 2: switch to AI mode, type a question
      ui = renderInput({ mode: "ai", text: "", ghost: "", showCursor: true });
      await typeInto(ui.textEl, "fix the failing auth test", 28);
      await sleep(reduced ? 0 : 500);

      // Frame 3: input clears, Claude responds in markdown, then suggestion appears
      renderInput({ mode: "ai", text: "", ghost: "", showCursor: true });
      const claudeBlock = document.createElement("div");
      claudeBlock.className = "t-block t-block--ai";
      claudeBlock.innerHTML =
        '<div class="t-block__header">' +
          '<span class="t-claude-logo">C</span>' +
          '<span class="t-ai-name">Claude</span>' +
          '<span class="t-stream-dot"></span>' +
        '</div>' +
        '<div class="t-block__body t-md" id="claude-md"></div>';
      body.appendChild(claudeBlock);
      const md = claudeBlock.querySelector("#claude-md");
      scrollBottom();

      const paragraphs = [
        '<p>Looks like there\'s one failing test in <code>tests/auth.test.ts</code>. Two likely culprits:</p>',
        '<ul>' +
          '<li>The token refresh path is comparing against <code>Date.now()</code> in seconds rather than ms.</li>' +
          '<li>The mock <strong>jwt.verify</strong> isn\'t restored between cases, so state bleeds across tests.</li>' +
        '</ul>',
        '<p>Want me to run it scoped first so we can confirm the failure before patching?</p>',
      ];
      for (const p of paragraphs) {
        const div = document.createElement("div");
        div.innerHTML = p;
        while (div.firstChild) md.appendChild(div.firstChild);
        scrollBottom();
        await sleep(reduced ? 0 : 550);
      }
      claudeBlock.querySelector(".t-stream-dot")?.remove();
      const dur = document.createElement("span");
      dur.className = "t-duration";
      dur.textContent = "1.4s";
      claudeBlock.querySelector(".t-block__header").appendChild(dur);
      await sleep(reduced ? 0 : 400);

      const suggest = block({
        aiName: "suggested command",
        dur: "",
        variant: "suggest",
        output:
          '<div><span class="t-dollar">$</span> <span style="color:#bec6d0">npm test -- --workspace=app tests/auth.test.ts</span></div>',
        actions: true,
      });
      await sleep(reduced ? 0 : 1400);

      // Frame 4: approve → real shell block with PASS output
      suggest.remove();
      block({
        cmd: "npm test -- --workspace=app tests/auth.test.ts",
        dur: "0.4s",
        output:
          '<div><span class="t-ok">PASS</span> tests/auth.test.ts</div>' +
          '<div>  <span class="t-ok">✓</span> rejects invalid token <span class="t-dim">(12ms)</span></div>' +
          '<div>  <span class="t-ok">✓</span> refreshes on expiry <span class="t-dim">(8ms)</span></div>' +
          '<div class="t-dim" style="margin-top:6px">Tests: 2 passed · Time: 0.4s</div>',
      });
      renderInput({ mode: "shell", text: "", ghost: "", showCursor: true });

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
