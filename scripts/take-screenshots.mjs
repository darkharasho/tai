import { _electron as electron } from 'playwright';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

const ROOT = process.cwd();
const SCREENSHOT_DIR = path.join(ROOT, 'docs', 'screenshots');
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

const MAIN_ENTRY = path.join(ROOT, 'dist-electron', 'main.js');

const DEMO_USERS = ['alex', 'jordan', 'sam', 'taylor', 'casey', 'morgan', 'riley', 'quinn'];
const DEMO_HOSTS = ['devbox', 'workstation', 'archlinux', 'fedora', 'macbook', 'thinkpad'];

function pickRandom(arr) {
  return arr[crypto.randomInt(arr.length)];
}

const demoUser = process.env.DEMO_USER || pickRandom(DEMO_USERS);
const demoHost = process.env.DEMO_HOST || pickRandom(DEMO_HOSTS);
console.log(`Demo identity: ${demoUser}@${demoHost}`);

console.log('Launching TAI...');
const app = await electron.launch({
  args: ['--no-sandbox', MAIN_ENTRY],
  env: {
    ...process.env,
    NODE_ENV: 'development',
    USER: demoUser,
    HOSTNAME: demoHost,
    HOME: process.env.HOME,
  },
});

const window = await app.firstWindow();
await window.waitForLoadState('domcontentloaded');

// The composer is a textarea (it grows with multi-line commands), not an input,
// and it shares the page with xterm's hidden helper textarea — hence the
// `data-composer` hook rather than a bare tag selector.
await window.waitForSelector('textarea[data-composer]', { timeout: 15000 });
console.log('App ready.');

const input = await window.$('textarea[data-composer]');

/** Type a line into the composer and run it. */
async function run(cmd, settle = 1800) {
  await input.focus();
  await input.fill(cmd);
  await window.keyboard.press('Enter');
  await window.waitForTimeout(settle);
}

async function clearScreen() {
  await input.focus();
  await window.keyboard.press('Control+l');
  await window.waitForTimeout(800);
}

const paneText = () => window.evaluate(() => document.body.innerText);

// The block list keeps its scroll position when content lands faster than the
// autoscroll settles, which crops the newest block — the AI answer, in the shot
// that is meant to be showing one — out of the bottom of the frame.
async function scrollToBottom() {
  await window.evaluate(() => {
    for (const el of document.querySelectorAll('div')) {
      if (el.scrollHeight > el.clientHeight + 8) el.scrollTop = el.scrollHeight;
    }
  });
  await window.waitForTimeout(400);
}

// Anonymise the prompt, then move into the project. Two things make this
// fiddly, and both fail silently:
//   - the composer accepts input before the shell behind it has drawn its
//     first prompt, and anything typed in that window is dropped;
//   - the shell integration replays the user's own PROMPT_COMMAND on every
//     prompt, and a distro PROMPT_COMMAND rebuilds PS1 from scratch, so a
//     bare `export PS1=...` is undone before it is ever displayed. Clearing
//     the snapshot the integration replays (`__tai_user_pc`) is what makes
//     the demo prompt stick.
// TAI reads the user, host and cwd it renders out of the prompt text, so this
// one assignment is what keeps the real machine out of the published images.
const demoIdent = `${demoUser}@${demoHost}`;
const projectLeaf = path.basename(ROOT);

let staged = false;
for (let attempt = 1; attempt <= 6 && !staged; attempt++) {
  await run(`__tai_user_pc=''; PS1='${demoIdent} ~/projects/${projectLeaf}$ '`, 700);
  await run(`cd ${ROOT}`, 900);
  // Checked against a fresh block rather than the whole pane: the command that
  // sets PS1 contains the demo identity itself, so checking before the clear
  // would pass even when the prompt never changed.
  await clearScreen();
  await run('echo ready', 900);
  staged = (await paneText()).includes(demoIdent);
  if (!staged) console.log(`  waiting for the shell… (attempt ${attempt})`);
}
if (!staged) {
  await app.close();
  throw new Error('The demo prompt never took — refusing to publish screenshots of the real environment.');
}
await clearScreen();

// Showcase commands, run from the project directory. Enough of them to fill the
// pane: blocks stack up from the composer, so a short run screenshots as a
// window mostly full of dead space.
const commands = [
  'cat package.json | head -6',
  'echo "Welcome to TAI — your AI-native terminal"',
  'ls --color=auto src/',
  'git diff --stat HEAD~1 HEAD',
  'git log --oneline -5',
];

for (const cmd of commands) {
  await run(cmd, 2000);
}

await window.waitForTimeout(1500);
await scrollToBottom();

console.log('Capturing terminal view...');
await window.screenshot({ path: path.join(SCREENSHOT_DIR, 'terminal.png') });

// Switch to AI mode and ask something real — the shot is captioned as showing
// a Markdown answer, so it has to contain one.
await input.focus();
await window.keyboard.press('Shift+Tab');
await window.waitForTimeout(600);

// Whatever trust level this machine happens to be set to, a published
// screenshot should not be advertising the one that skips approvals.
for (let i = 0; i < 4; i++) {
  const level = await window.evaluate(
    () => document.querySelector('[data-perm-badge]')?.getAttribute('data-perm-badge'),
  );
  if (!level || level === 'ask') break;
  await window.click('[data-perm-badge]');
  await window.waitForTimeout(300);
}

await input.focus();
await input.fill('in one sentence, what is a bash heredoc? include a short example');
await window.waitForTimeout(400);
await window.keyboard.press('Enter');

// Wait out the stream; if the provider is not configured on this machine, fall
// back to capturing whatever is on screen rather than failing the run.
try {
  await window.waitForSelector('[data-ai-turn]', { timeout: 30000 });
  await window.waitForFunction(
    () => !!document.querySelector('[data-ai-turn]') && !document.querySelector('[data-ai-turn][data-streaming]'),
    null,
    { timeout: 120000 },
  );
  await window.waitForTimeout(1200);
} catch {
  console.warn('! AI answer never completed — capturing the composer state instead.');
}

await scrollToBottom();
console.log('Capturing AI mode view...');
await window.screenshot({ path: path.join(SCREENSHOT_DIR, 'ai-mode.png') });

await app.close();

// Reduce PNG size with color reduction (terminal UIs don't need full 24-bit)
for (const name of ['terminal.png', 'ai-mode.png']) {
  const file = path.join(SCREENSHOT_DIR, name);
  const { execSync } = await import('child_process');
  try {
    execSync(`magick "${file}" -colors 128 "${file}"`);
  } catch {
    // magick not available, keep original
  }
}

console.log(`Done — screenshots saved to ${SCREENSHOT_DIR}`);
