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
 * From Task 8 the `transitions` timeline interleaves the resolver's own
 * decisions (`mode:<owner>:<provenance>`) with the raw termios readings, in
 * recorded order. The old `altScreen:*` / `interactive:*` labels are gone with
 * the callbacks that produced them: they reported what one of three competing
 * deciders thought, and there is now one decider.
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
  // FIXED (Task 8) for the transitions: the recording contains no alt-screen
  // enter sequence at all — `claude` is an Ink TUI that repositions the cursor
  // without switching screens — and the timeline no longer claims one. The
  // cursor-reposition regex is now a `tuiHint`, which resolves to a DOCKED
  // program labelled `inferred`; the cooked termios reading that follows then
  // authoritatively overrules the guess and hands the input back to the shell.
  // Pre-Task-8 that correction was invisible: the false alt screen outranked
  // termios and the 500ms debounce delayed the reading besides.
  //
  // KNOWN-BAD, but NOT a routing bug and NOT fixed by Task 9: the `claude`
  // block is missing because the capture ends while claude is still foreground.
  // The recording's last bytes are claude's teardown; no OSC 133 D/A ever
  // arrives, so the block is never finalized and can never be emitted, whatever
  // routing does with its bytes. Task 9 did change what happens to those bytes
  // — they are now retained rather than discarded — but a block that never ends
  // has nothing to show them in. Fixing this needs a re-capture that lets
  // claude exit (fixtures are immutable), not a code change.
  it('claude-ink: Ink TUI never enters alt screen', () => {
    const { blocks, transitions } = replayFixture('claude-ink');
    expect(transitions).toMatchInlineSnapshot(`
      [
        "mode:program:inferred",
        "termios:cooked",
        "mode:shell:authoritative",
      ]
    `);
    expect(blocks.map(b => b.command)).toMatchInlineSnapshot(`
      [
        "export PS1='devuser@devbox:~$ '; cd /tmp/tai-fixtures; clear",
      ]
    `);
  });

  // KNOWN-BAD, but NOT fixed by Task 9, and the earlier diagnosis was wrong:
  // the vite block never appears because vite is still running when the capture
  // stops. There is no OSC 133 D and no following A, so the block is never
  // finalized — block attribution here is lifecycle, not routing. (The single
  // `termios:cooked` reading also agrees with the initial state, so it produces
  // no transition.) Needs a re-capture where vite exits, not a code change.
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

  // FIXED (Task 8): another alt-screen false positive, now honest. The REPL's
  // cursor-back redraws (\x1b[<n>D) trip TUI_REPOSITION_RE and the recording
  // has no [?1049h in it, so the guess resolves to a docked program labelled
  // `inferred` rather than to a fullscreen takeover. The second transition is
  // the next OSC 133 prompt clearing the latch — a command boundary is proof
  // the shell is foreground again, hence `authoritative`.
  it('python-repl: cursor-back prompt redraws', () => {
    const { blocks, transitions } = replayFixture('python-repl');
    expect(transitions).toMatchInlineSnapshot(`
      [
        "mode:program:inferred",
        "mode:shell:authoritative",
      ]
    `);
    expect(blocks.map(b => b.command)).toMatchInlineSnapshot(`
      [
        "export PS1='devuser@devbox:~$ '; cd /tmp/tai-fixtures; clear",
        "python3",
      ]
    `);
    // FIXED (Task 9): the block used to end at the banner. Everything the user
    // actually did in the REPL — `2 + 2`, its answer, `exit()` — arrived after
    // the cursor-back redraws tripped the false alt-screen latch, and
    // `_routeChunk` discarded it. Retention now holds those bytes on the guess
    // and, since no authoritative signal ever confirms it, the block replays
    // them as it ends. This is the whole point of the task, and it is the one
    // fixture in the corpus that can show it: the two below end mid-command.
    expect(blocks[1].output).toMatchInlineSnapshot(`
      "Python 3.14.6 (main, Jun 10 2026, 10:03:53) [GCC 13.3.0] on linux
      Type "help", "copyright", "credits" or "license" for more information.
      >>> 2 + 2
      4
      >>> exit()"
    `);
  });

  // CORRECT baseline: htop really does enter and leave the alt screen, and the
  // block is attributed properly. This is the case where dropping bytes is the
  // right call — it is here to catch a fix that over-corrects.
  it('htop-altscreen: genuine alt screen', () => {
    const { blocks, transitions } = replayFixture('htop-altscreen');
    // Task 8 relabelled only: a real [?1049h still resolves to fullscreen, and
    // still AUTHORITATIVELY — which is what separates it from the two entries
    // above and what keeps dropping its bytes the right call.
    expect(transitions).toMatchInlineSnapshot(`
      [
        "mode:fullscreen:authoritative",
        "mode:shell:authoritative",
      ]
    `);
    expect(blocks.map(b => b.command)).toMatchInlineSnapshot(`
      [
        "export PS1='devuser@devbox:~$ '; cd /tmp/tai-fixtures; clear",
        "htop",
      ]
    `);
    // The over-correction guard, made explicit in Task 9: a real alt screen is
    // `fullscreen` + `authoritative`, so its bytes are still dropped outright
    // and never enter the side buffer. If retention ever starts replaying here,
    // the block fills with htop redraw frames.
    expect(blocks[1].output).toBe('');
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

  // KNOWN-BAD: block 5's `commandFromShell` ("fish") leaks across a shell
  // nesting boundary. The block itself is fish's own `exit` (fish's C..D;0
  // bounds it), but the outer bash's precmd for its own `fish` command
  // fires after fish's D marker and is attributed to this block's
  // `commandFromShell` metadata. `command` is right for a different reason:
  // no preexec reaches blocks 3-5 at all in this recording (hence
  // fromShell: undefined on 3 and 4), so they come from echo
  // reconstruction, which happens to reconstruct them correctly. Fixing the
  // cross-shell `commandFromShell` leak is out of Task 5's scope.
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
          "command": "exit",
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
