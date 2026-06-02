// Rebuild native modules against Electron's ABI after install.
//
// node-pty is cross-platform. node-termios is POSIX-only — it includes
// <termios.h>, which does not exist on Windows, so it cannot compile there.
// The termios poller (electron/services/termiosPoller.ts) lazy-requires it and
// degrades gracefully when it is absent, so on Windows we simply skip it.
import { execSync } from 'node:child_process';

const modules = ['node-pty'];
if (process.platform !== 'win32') modules.push('node-termios');

// Use --only (restrictive): electron-rebuild auto-detects ALL native modules,
// so -w/--which-module is additive and cannot exclude node-termios. --only
// pins the exact set we want built on this platform.
const cmd = `electron-rebuild --only ${modules.join(',')}`;
console.log(`[postinstall] ${cmd} (platform=${process.platform})`);
execSync(cmd, { stdio: 'inherit' });
