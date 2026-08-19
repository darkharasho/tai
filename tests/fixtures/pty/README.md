# PTY fixtures

Recorded PTY sessions in the JSONL format defined by `src/utils/ptyRecording.ts`,
replayed by `tests/helpers/replayPty.ts`.

## Capturing a fixture

    npm run build
    REAL_HOME=$HOME REAL_USER=$(id -un) ./scripts/capture-in-ns.sh <scenario>

`scripts/capture-fixture.mjs` drives the real app under Playwright and calls the
same `__taiSaveRecording()` hook a human would; `scripts/capture-in-ns.sh` wraps
it in a namespace that makes the identity the recording captures a false one.
Add a scenario to the `SCENARIOS` table there, then inspect the result:

    node scripts/inspect-fixture.mjs tests/fixtures/pty/<scenario>.jsonl

Read the decoded output before committing. The capture masks the values it knows
about; it cannot know what a new scenario will print.

### Why the capture is not just "run the app and save"

Each of these cost a debugging session, and a fixture captured without them is
either empty or unpublishable:

- **Open a fresh tab.** Restored sessions have no live pty behind them and
  record nothing at all.
- **Stage the app outside the checkout** and bind-mount `node_modules` over the
  staged path. TAI sources its shell integration by absolute path, and Electron
  resolves its own binary through `/proc/self/exe` — so a fixture captured from
  the checkout puts your home directory into the recording, and into htop's
  process table.
- **Mask the identity sources.** TAI spawns a *login* shell, so `/etc/profile.d`
  runs every time. On systemd 257+ that stamps user, hostname, machine-id and
  boot-id into every prompt via OSC 3008. `/etc/profile` reads the hostname from
  `hostnamectl --transient`, which asks the host's systemd over D-Bus and walks
  straight out of a UTS namespace, and TAI's `systemd-run --user --scope` spawn
  path does the same for the shell itself. Both are masked inside the namespace.
- **Use a PID namespace.** htop renders the host's whole process table.

## Rules

- **Never re-chunk or pretty-print a fixture.** The chunk boundaries are the
  data. `_altScreenTail` in BlockSegmenter exists solely because escape
  sequences split across chunks; joining them makes the fixture test nothing.
- **Never hand-edit the base64 payloads.** Re-record instead.
- Recordings are raw and unredacted by design — redacting bytes would corrupt
  escape sequences. That is why the check above is a manual read-through, not an
  automated filter.
- **Never type a real credential during a capture.** The `sudo-password` fixture
  uses a deliberately wrong passphrase; the termios shape it pins is identical
  either way.
