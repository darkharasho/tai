import { describe, it, expect } from 'vitest';
import { replayFixture } from '../helpers/replayPty';

/**
 * BASELINE CORPUS — captured against pre-migration behaviour.
 *
 * Some expectations below are marked KNOWN-BAD: they encode behaviour that is
 * wrong today and that later tasks in this plan deliberately change. They are
 * committed anyway. Without a pinned baseline there is no way to tell a fix
 * from a regression on exactly the bugs that resist manual reproduction.
 *
 * When a task changes one of these, update the expectation IN THAT TASK'S
 * COMMIT and drop the KNOWN-BAD marker with a note saying which task fixed it.
 *
 * Capture provenance: recorded by scripts/capture-in-ns.sh driving the real app
 * (see tests/fixtures/pty/README.md). Two scenarios differ from the plan's text
 * because the capture host could not produce the original: `prompt-redraw` uses
 * fish's autosuggestion ghost text rather than p10k/starship, and
 * `sudo-password` uses an encrypted-key passphrase prompt rather than sudo,
 * since the capture runs as root in a namespace where sudo never prompts. Both
 * exercise the same mechanism the fixture exists to pin.
 */
describe('PTY replay corpus (baseline)', () => {
  // KNOWN-BAD (Tasks 5-8 fix): the recording contains no alt-screen enter
  // sequence at all — `claude` is an Ink TUI that repositions the cursor
  // without switching screens — yet the segmenter reports altScreen:true off
  // TUI_REPOSITION_RE. The `claude` block is missing for the same reason: once
  // the false alt-screen latch is set, _routeChunk discards its output.
  it('claude-ink: Ink TUI never enters alt screen', () => {
    const { blocks, transitions } = replayFixture('claude-ink');
    expect(transitions).toMatchInlineSnapshot(`
      [
        "altScreen:true",
        "termios:cooked",
      ]
    `);
    expect(blocks.map(b => b.command)).toMatchInlineSnapshot(`
      [
        "export PS1='devuser@devbox:~$ '; cd /tmp/tai-fixtures; clear",
      ]
    `);
  });

  // KNOWN-BAD (Tasks 5-8 fix): the vite block never appears — only the setup
  // block survives. The raw-mode flip is visible to termios but the command
  // that caused it was never attributed to a block.
  it('vite-shortcuts: raw-mode flip mid-session', () => {
    const { blocks, transitions } = replayFixture('vite-shortcuts');
    expect(transitions).toMatchInlineSnapshot(`
      [
        "termios:cooked",
      ]
    `);
    expect(blocks.map(b => b.command)).toMatchInlineSnapshot(`
      [
        "export PS1='devuser@devbox:~$ '; cd /tmp/tai-fixtures; clear",
      ]
    `);
  });

  // KNOWN-BAD (Tasks 5-8 fix): another alt-screen false positive. The REPL's
  // cursor-back redraws (\x1b[<n>D) trip TUI_REPOSITION_RE; the recording has
  // no [?1049h in it.
  it('python-repl: cursor-back prompt redraws', () => {
    const { blocks, transitions } = replayFixture('python-repl');
    expect(transitions).toMatchInlineSnapshot(`
      [
        "altScreen:true",
        "altScreen:false",
      ]
    `);
    expect(blocks.map(b => b.command)).toMatchInlineSnapshot(`
      [
        "export PS1='devuser@devbox:~$ '; cd /tmp/tai-fixtures; clear",
        "python3",
      ]
    `);
  });

  // CORRECT baseline: htop really does enter and leave the alt screen, and the
  // block is attributed properly. This is the case where dropping bytes is the
  // right call — it is here to catch a fix that over-corrects.
  it('htop-altscreen: genuine alt screen', () => {
    const { blocks, transitions } = replayFixture('htop-altscreen');
    expect(transitions).toMatchInlineSnapshot(`
      [
        "altScreen:true",
        "altScreen:false",
      ]
    `);
    expect(blocks.map(b => b.command)).toMatchInlineSnapshot(`
      [
        "export PS1='devuser@devbox:~$ '; cd /tmp/tai-fixtures; clear",
        "htop",
      ]
    `);
  });

  // KNOWN-BAD (Task 10 fixes): `ls` runs on the remote host inside the ssh
  // session, but every block reports isRemote:false — the remote boundary is
  // invisible, so AI context and re-run treat these as local commands.
  it('ssh-interactive: interactive session', () => {
    const { blocks, transitions } = replayFixture('ssh-interactive');
    expect(transitions).toMatchInlineSnapshot(`[]`);
    expect(blocks.map(b => ({ command: b.command, isRemote: b.isRemote }))).toMatchInlineSnapshot(`
      [
        {
          "command": "export PS1='devuser@devbox:~$ '; cd /tmp/tai-fixtures; clear",
          "isRemote": false,
        },
        {
          "command": "ssh taidev",
          "isRemote": false,
        },
        {
          "command": "ls",
          "isRemote": false,
        },
      ]
    `);
  });

  it('ssh-oneshot: stays a normal block', () => {
    const { blocks, transitions } = replayFixture('ssh-oneshot');
    expect(transitions).toMatchInlineSnapshot(`[]`);
    expect(blocks.map(b => ({ command: b.command, isRemote: b.isRemote }))).toMatchInlineSnapshot(`
      [
        {
          "command": "export PS1='devuser@devbox:~$ '; cd /tmp/tai-fixtures; clear",
          "isRemote": false,
        },
        {
          "command": "ssh taidev-run ls /tmp/tai-fixtures",
          "isRemote": false,
        },
      ]
    `);
  });

  // Fixed by Task 5: command now comes from the preexec hook verbatim.
  it('prompt-redraw: command reconstruction under redraws', () => {
    const { blocks } = replayFixture('prompt-redraw');
    expect(blocks.map(b => ({ command: b.command, fromShell: b.commandFromShell }))).toMatchInlineSnapshot(`
      [
        {
          "command": "export PS1='devuser@devbox:~$ '; cd /tmp/tai-fixtures; clear",
          "fromShell": "export PS1='devuser@devbox:~$ '; cd /tmp/tai-fixtures; clear",
        },
        {
          "command": "fish",
          "fromShell": "fish",
        },
        {
          "command": "echo alpha bravo charlie delta",
          "fromShell": undefined,
        },
        {
          "command": "echo alpha",
          "fromShell": undefined,
        },
        {
          "command": "fish",
          "fromShell": "fish",
        },
      ]
    `);
  });

  // CORRECT baseline: the !ECHO && ICANON prompt is detected, and it is the
  // only signal in this recording — no inferred transition competes with it.
  it('sudo-password: password prompt shape', () => {
    const { transitions } = replayFixture('sudo-password');
    expect(transitions).toMatchInlineSnapshot(`
      [
        "termios:password",
      ]
    `);
  });
});
