/**
 * Capture a baseline PTY fixture by driving the real app.
 *
 * The recording must come from the app's own capture path: chunk boundaries are
 * produced by CoalescingBuffer in main and termios events by the 200ms poller,
 * so a standalone node-pty harness would record subtly different data. This
 * launches the built app under Playwright, reproduces one scenario, and calls
 * the same `__taiSaveRecording` debug hook a human would.
 *
 * Usage: node scripts/capture-fixture.mjs <fixture-name>
 *
 * Identity is faked at launch (USER/HOSTNAME) and via PS1 so recordings carry
 * no real username or hostname — the fixtures are committed unredacted, and
 * hand-editing base64 payloads after the fact would desync chunk boundaries
 * from content.
 */
import { _electron as electron } from 'playwright';
import path from 'path';
import fs from 'fs';
import { execFileSync } from 'child_process';

const ROOT = process.cwd();
// The app is staged under a neutral path before launch: TAI sources its shell
// integration by absolute path, so running from the checkout types the
// operator's home directory and repo location straight into the recording.
const STAGE = '/tmp/tai-capture';
const MAIN_ENTRY = path.join(STAGE, 'dist-electron', 'main.js');

function stageApp() {
  fs.rmSync(STAGE, { recursive: true, force: true });
  fs.mkdirSync(STAGE, { recursive: true });
  for (const rel of ['dist', 'dist-electron', 'package.json']) {
    fs.cpSync(path.join(ROOT, rel), path.join(STAGE, rel), { recursive: true });
  }
  fs.mkdirSync(path.join(STAGE, 'electron'), { recursive: true });
  fs.cpSync(
    path.join(ROOT, 'electron', 'shell-integration'),
    path.join(STAGE, 'electron', 'shell-integration'),
    { recursive: true },
  );
  // Bind-mount rather than symlink: Electron resolves its own binary through
  // /proc/self/exe, and a symlink resolves back to the checkout — which is how
  // the operator's home directory ends up in htop's process table. The capture
  // runs as root inside a user namespace (scripts/capture-in-ns.sh), so the
  // mount is available and disappears with the namespace.
  const stagedModules = path.join(STAGE, 'node_modules');
  fs.mkdirSync(stagedModules, { recursive: true });
  execFileSync('mount', ['--bind', path.join(ROOT, 'node_modules'), stagedModules]);
}
const OUT_DIR = path.join(ROOT, 'tests', 'fixtures', 'pty');
const WORK_DIR = '/tmp/tai-fixtures';
// Capture runs against a scratch HOME so the operator's shell config, prompt
// theme, MOTD and restored sessions stay out of a fixture that is committed
// unredacted — and so successive captures are byte-stable.
const FAKE_HOME = '/tmp/tai-fixture-home';
// The namespace remaps the user, but sshd runs outside it and still needs the
// operator's real account and key.
const REAL_HOME = process.env.REAL_HOME || '/home/mstephens';
const REAL_USER = process.env.REAL_USER || 'mstephens';

const DEMO_USER = 'devuser';
const DEMO_HOST = 'devbox';
const PS1 = `${DEMO_USER}@${DEMO_HOST}:~$ `;

function seedFakeHome() {
  fs.mkdirSync(FAKE_HOME, { recursive: true });
  fs.writeFileSync(path.join(FAKE_HOME, '.zshrc'), `PROMPT='${PS1}'\nunsetopt PROMPT_SP\n`);
  // Clearing PROMPT_COMMAND makes /etc/profile.d/80-systemd-osc-context.sh
  // skip itself. Left alone it stamps user, hostname, machine-id and boot-id
  // into every prompt via OSC 3008 — straight into a fixture that gets
  // committed. TAI's own integration is sourced later and re-adds its hook, so
  // the OSC 133 markers the corpus depends on are unaffected.
  fs.writeFileSync(
    path.join(FAKE_HOME, '.bashrc'),
    `PS1='${PS1}'\nPROMPT_COMMAND=\nunset systemd_osc_context_shell_id systemd_osc_context_cmd_id\n`,
  );
  fs.writeFileSync(path.join(FAKE_HOME, '.hushlogin'), '');
  fs.mkdirSync(path.join(FAKE_HOME, '.config', 'fish'), { recursive: true });
  fs.writeFileSync(
    path.join(FAKE_HOME, '.config', 'fish', 'config.fish'),
    `function fish_prompt; echo -n '${PS1}'; end\n`,
  );
  // Write a dedicated ssh config rather than copying the operator's. The
  // interactive alias forces a bare remote shell with a fixed prompt: sshd runs
  // outside this namespace, so without it the remote MOTD and prompt would put
  // the real user and hostname back into the fixture.
  const fakeSsh = path.join(FAKE_HOME, '.ssh');
  fs.mkdirSync(fakeSsh, { recursive: true });
  const key = path.join(fakeSsh, 'id_fixture');
  fs.copyFileSync(path.join(process.env.SUDO_HOME || REAL_HOME, '.ssh', 'tai_fixture_tmp'), key);
  fs.chmodSync(key, 0o600);
  fs.writeFileSync(path.join(fakeSsh, 'config'), [
    'Host taidev',
    '  HostName localhost',
    `  User ${REAL_USER}`,
    `  IdentityFile ${key}`,
    '  IdentitiesOnly yes',
    '  StrictHostKeyChecking accept-new',
    '  RequestTTY yes',
    `  RemoteCommand env -i HOME=${WORK_DIR} TERM=$TERM PATH=/usr/bin:/bin PS1='${DEMO_USER}@remote:~$ ' bash --norc --noprofile -i`,
    '',
    'Host taidev-run',
    '  HostName localhost',
    `  User ${REAL_USER}`,
    `  IdentityFile ${key}`,
    '  IdentitiesOnly yes',
    '  StrictHostKeyChecking accept-new',
    '',
  ].join('\n'));
  fs.chmodSync(path.join(fakeSsh, 'config'), 0o600);
  // A passphrase-protected throwaway key, for the password-prompt fixture.
  const locked = path.join(fakeSsh, 'locked_key');
  fs.rmSync(locked, { force: true });
  fs.rmSync(locked + '.pub', { force: true });
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', 'fixture-passphrase', '-C', 'fixture', '-f', locked]);
  fs.chmodSync(fakeSsh, 0o700);
}

// `cmd` types into the composer and presses Enter (the normal block path).
// `keys` presses keys against the xterm surface a raw-mode program owns.
// `wait` lets a program settle — TUIs paint asynchronously.
const SCENARIOS = {
  'claude-ink': [
    { cmd: 'claude' },
    { wait: 6000 },
    { keys: ['h', 'i'], target: 'xterm' },
    { wait: 1500 },
    { keys: ['Control+c'], target: 'xterm' },
    { wait: 500 },
    { keys: ['Control+c'], target: 'xterm' },
    { wait: 1500 },
  ],
  'vite-shortcuts': [
    { cmd: `cd ${STAGE} && ./node_modules/.bin/vite --port 5199 dist` },
    { wait: 6000 },
    { keys: ['h'], target: 'xterm' },
    { wait: 1500 },
    { keys: ['q'], target: 'xterm' },
    { wait: 2000 },
  ],
  'python-repl': [
    { cmd: 'python3' },
    { wait: 3000 },
    { type: '2 + 2', target: 'xterm' },
    { keys: ['Enter'], target: 'xterm' },
    { wait: 1000 },
    { type: 'exit()', target: 'xterm' },
    { keys: ['Enter'], target: 'xterm' },
    { wait: 1500 },
  ],
  'htop-altscreen': [
    { cmd: 'htop' },
    { wait: 5000 },
    { keys: ['q'], target: 'xterm' },
    { wait: 2000 },
  ],
  'ssh-interactive': [
    { cmd: 'ssh taidev' },
    { wait: 5000 },
    { type: 'ls', target: 'xterm' },
    { keys: ['Enter'], target: 'xterm' },
    { wait: 1500 },
    { type: 'exit', target: 'xterm' },
    { keys: ['Enter'], target: 'xterm' },
    { wait: 2000 },
  ],
  'ssh-oneshot': [
    { cmd: `ssh taidev-run ls ${WORK_DIR}` },
    { wait: 4000 },
  ],
  // No zsh/p10k/starship on the capture host. fish's autosuggestion ghost text
  // is the same defect class this fixture pins: the composer reconstructs the
  // command from echoed bytes and picks up glyphs the user never typed.
  'prompt-redraw': [
    { cmd: 'fish' },
    { wait: 3000 },
    { type: 'echo alpha bravo charlie delta', target: 'xterm' },
    { wait: 800 },
    { keys: ['Enter'], target: 'xterm' },
    { wait: 1000 },
    { type: 'echo alpha', target: 'xterm' },
    { wait: 1200 },
    { keys: ['End'], target: 'xterm' },
    { wait: 500 },
    { keys: ['Enter'], target: 'xterm' },
    { wait: 1000 },
    { type: 'exit', target: 'xterm' },
    { keys: ['Enter'], target: 'xterm' },
    { wait: 1500 },
  ],
  // The capture runs as root inside a user namespace, where sudo never prompts,
  // so this pins the same termios shape with an encrypted-key passphrase prompt
  // instead: !ECHO && ICANON either way. The passphrase typed here is wrong on
  // purpose — no real credential ever enters the ring buffer.
  'sudo-password': [
    { cmd: 'ssh-keygen -y -f ~/.ssh/locked_key' },
    { wait: 2500 },
    { type: 'not-a-real-passphrase', target: 'xterm' },
    { keys: ['Enter'], target: 'xterm' },
    { wait: 2500 },
  ],
};

const name = process.argv[2];
if (!name || !SCENARIOS[name]) {
  console.error(`usage: node scripts/capture-fixture.mjs <${Object.keys(SCENARIOS).join('|')}>`);
  process.exit(1);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(WORK_DIR, { recursive: true });
seedFakeHome();
stageApp();
const outPath = path.join(OUT_DIR, `${name}.jsonl`);

// Every mounted tab keeps its composer in the DOM, so match only the visible
// one — and the newest, since capture always runs in a freshly opened tab.
const COMPOSER = 'textarea:not(.xterm-helper-textarea):visible';
// xterm's helper textarea is deliberately off-screen, so it never matches
// :visible — take the newest one and focus it through the DOM.
const XTERM = '.xterm-helper-textarea';

const app = await electron.launch({
  // Launch through the staged path, not the checkout's: htop and friends render
  // argv[0] verbatim, so the binary's own path would put the operator's home
  // directory and repo location into a committed fixture.
  executablePath: path.join(STAGE, 'node_modules', 'electron', 'dist', 'electron'),
  args: ['--no-sandbox', MAIN_ENTRY],
  env: {
    ...process.env,
    NODE_ENV: 'development',
    HOME: FAKE_HOME,
    USER: DEMO_USER,
    LOGNAME: DEMO_USER,
    HOSTNAME: DEMO_HOST,
    PS1,
  },
});

// The save action opens a native dialog no automated driver can click. Patch it
// to answer with the fixture path; everything downstream is the real code path.
await app.evaluate(({ dialog }, filePath) => {
  dialog.showSaveDialog = async () => ({ canceled: false, filePath });
}, outPath);

const win = await app.firstWindow();
// The save path asks for confirmation via window.confirm; Playwright dismisses
// dialogs by default, which silently turns every capture into a no-op.
win.on('dialog', d => d.accept());
await win.waitForLoadState('domcontentloaded');
// The composer is a plain textarea; xterm mounts its own hidden helper
// textarea alongside it, so select by exclusion rather than by the
// build-hashed CSS-module class.
await win.waitForSelector(COMPOSER, { timeout: 20000 });
await win.waitForTimeout(2500);

// Always capture in a brand-new tab. The app restores previous sessions on
// launch, and a restored tab has no live pty behind it — driving one records
// nothing at all. A fresh tab also guarantees the ring buffer holds this
// scenario alone, and keeps the operator's real shell history out of a fixture
// that gets committed unredacted.
const addBtn = await win.$('[class*="_addBtn_"]');
if (!addBtn) throw new Error('could not find the new-tab button');
await addBtn.click();
await win.waitForTimeout(4000);

async function runCommand(text) {
  const input = win.locator(COMPOSER).last();
  await input.focus();
  await input.fill(text);
  await win.keyboard.press('Enter');
}

// Not every raw-mode scenario mounts an xterm surface — a password prompt or a
// nested shell can stay on the composer. Drive whichever one the app actually
// put in front of the user, the same choice a human at the keyboard makes.
async function focusTarget() {
  const onXterm = await win.evaluate((sel) => {
    const all = document.querySelectorAll(sel);
    const el = all[all.length - 1];
    if (!el) return false;
    el.focus();
    return document.activeElement === el;
  }, XTERM);
  if (onXterm) return;
  // A password prompt replaces the composer with its own field.
  const composer = win.locator(COMPOSER).last();
  if (await composer.count()) { await composer.focus(); return; }
  await win.locator('input:visible').last().focus();
}

// One setup block, kept to a single line so it costs exactly one leading block
// in the recording rather than several.
await runCommand(`export PS1='${PS1}'; cd ${WORK_DIR}; clear`);
await win.waitForTimeout(1500);

for (const step of SCENARIOS[name]) {
  if (step.wait) { await win.waitForTimeout(step.wait); continue; }
  if (step.cmd) { await runCommand(step.cmd); continue; }
  if (step.target === 'xterm') await focusTarget();
  if (step.type) await win.keyboard.type(step.type, { delay: 60 });
  for (const k of step.keys ?? []) await win.keyboard.press(k);
}

// Electron renders window.confirm as a native message box that no automated
// driver can click and Playwright's dialog event does not intercept. Stub it
// for the save call only — the confirmation exists for humans, and this run is
// the explicit user intent it is asking about.
await win.evaluate(() => { window.confirm = () => true; });
const saved = await win.evaluate(() => window.__taiSaveRecording?.());
await win.waitForTimeout(1000);
await app.close();

if (!fs.existsSync(outPath)) {
  console.error(`FAILED: no recording written to ${outPath} (hook returned ${JSON.stringify(saved)})`);
  process.exit(1);
}
const lines = fs.readFileSync(outPath, 'utf8').split('\n').filter(Boolean);
console.log(`wrote ${outPath}: ${lines.length} entries, ${fs.statSync(outPath).size} bytes`);
