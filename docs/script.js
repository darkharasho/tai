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

      const l1 = line(promptHTML + '<span class="t-user" id="u1"></span><span class="t-ghost" id="g1"></span><span class="t-cursor"></span>');
      const u1 = l1.querySelector("#u1");
      const g1 = l1.querySelector("#g1");
      await typeInto(u1, "npm te");
      g1.textContent = "st -- --watch";
      await sleep(reduced ? 0 : 900);

      l1.querySelector(".t-cursor")?.remove();
      g1.remove();
      u1.textContent = "fix the failing auth test";
      line('<span class="t-banner">AI mode · Shift+Tab</span>');
      await sleep(reduced ? 0 : 500);

      line('<span class="t-ai">claude ›</span> <span class="t-dim">I see one failing test in</span> <span class="t-user">tests/auth.test.ts</span><span class="t-dim">. Suggested:</span>');
      line('  <span class="t-prompt">$</span> <span class="t-user">npm test -- --workspace=app tests/auth.test.ts</span>');
      const hints = line('  <span class="t-dim"><span class="t-kbd">Enter</span> approve  <span class="t-kbd">E</span> edit  <span class="t-kbd">Esc</span> reject</span>');
      await sleep(reduced ? 0 : 1100);

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
});
