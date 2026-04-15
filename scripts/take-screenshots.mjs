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
await window.waitForTimeout(3000);

await window.waitForSelector('input', { timeout: 10000 });
console.log('App ready.');

const input = await window.$('input');
await input.focus();

// Override prompt to use demo identity, cd to project, then clear
await input.fill(`export PS1='${demoUser}@${demoHost}:~/projects/tai\\$ '`);
await window.keyboard.press('Enter');
await window.waitForTimeout(500);
await input.focus();
await input.fill(`cd ${ROOT}`);
await window.keyboard.press('Enter');
await window.waitForTimeout(2000);
await input.focus();
await window.keyboard.press('Control+l');
await window.waitForTimeout(1000);

// Run showcase commands from the project directory
const commands = [
  'cat package.json | head -6',
  'echo "Welcome to TAI — your AI-native terminal"',
  'ls --color=auto src/',
  'git log --oneline -5',
];

for (const cmd of commands) {
  await input.focus();
  await input.fill(cmd);
  await window.keyboard.press('Enter');
  await window.waitForTimeout(2000);
}

await window.waitForTimeout(1500);

console.log('Capturing terminal view...');
await window.screenshot({ path: path.join(SCREENSHOT_DIR, 'terminal.png') });

// Switch to AI mode
await input.focus();
await window.keyboard.press('Shift+Tab');
await window.waitForTimeout(500);
await input.fill('explain what this project does');
await window.waitForTimeout(1000);

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
