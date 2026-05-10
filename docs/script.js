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

  if (body) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    const shellPrompt = '<span class="t-user-name">mstephens</span> <span class="t-path">~/projects/app</span> <span class="t-dollar">$</span> ';
    const aiPrompt = '<span class="t-sparkle">✦</span> <span class="t-path">~/projects/app</span> ';

    async function typeInto(el, text, speed = 36) {
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

      // Frame 1: shell prompt + ghost-text prediction
      const l1 = line(shellPrompt + '<span class="t-user" id="u1"></span><span class="t-ghost" id="g1"></span><span class="t-cursor"></span>');
      const u1 = l1.querySelector("#u1");
      const g1 = l1.querySelector("#g1");
      await typeInto(u1, "npm te");
      g1.textContent = "st -- --watch";
      await sleep(reduced ? 0 : 900);

      // Frame 2: switch to AI mode, replace input
      l1.remove();
      line('<span class="t-banner"><span class="t-sparkle">✦</span> AI mode · Shift+Tab</span>');
      const l2 = line(aiPrompt + '<span class="t-user" id="u2"></span><span class="t-cursor"></span>');
      const u2 = l2.querySelector("#u2");
      await typeInto(u2, "fix the failing auth test", 30);
      l2.querySelector(".t-cursor")?.remove();
      await sleep(reduced ? 0 : 400);

      // Frame 3: Claude responds with a suggestion block
      const ai = line(
        '<div class="t-block t-block--ai">' +
          '<div class="t-block__header">' +
            '<span class="t-pulse t-pulse--ai"></span>' +
            '<span>claude · sonnet 4.6</span>' +
            '<span class="t-duration">1.2s</span>' +
          '</div>' +
          '<div><span class="t-dim">I see one failing test in </span><span style="color:#bec6d0">tests/auth.test.ts</span><span class="t-dim">. Running it scoped should reproduce it:</span></div>' +
        '</div>'
      );
      await sleep(reduced ? 0 : 600);

      const suggest = line(
        '<div class="t-block t-block--suggest">' +
          '<div class="t-block__header"><span style="color:#ea580c">●</span> <span>suggested command</span></div>' +
          '<div><span class="t-dollar">$</span> <span style="color:#bec6d0">npm test -- --workspace=app tests/auth.test.ts</span></div>' +
          '<div class="t-actions">' +
            '<span class="t-approve">Enter · approve</span>' +
            '<span class="t-edit">E · edit</span>' +
            '<span class="t-reject">Esc · reject</span>' +
          '</div>' +
        '</div>'
      );
      await sleep(reduced ? 0 : 1300);

      // Frame 4: approve → command block with PASS output
      suggest.remove();
      line(shellPrompt + '<span style="color:#bec6d0">npm test -- --workspace=app tests/auth.test.ts</span>');
      const out = line(
        '<div class="t-block">' +
          '<div class="t-block__header">' +
            '<span class="t-pulse"></span>' +
            '<span>shell</span>' +
            '<span class="t-duration">0.4s</span>' +
          '</div>' +
          '<div><span class="t-ok">PASS</span> tests/auth.test.ts</div>' +
          '<div>  <span class="t-ok">✓</span> rejects invalid token <span class="t-dim">(12ms)</span></div>' +
          '<div>  <span class="t-ok">✓</span> refreshes on expiry <span class="t-dim">(8ms)</span></div>' +
          '<div class="t-dim" style="margin-top:6px">Tests: 2 passed · Time: 0.4s</div>' +
        '</div>'
      );
      line(shellPrompt + '<span class="t-cursor"></span>');

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
