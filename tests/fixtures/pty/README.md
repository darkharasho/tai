# PTY fixtures

Recorded PTY sessions in the JSONL format defined by `src/utils/ptyRecording.ts`,
replayed by `tests/helpers/replayPty.ts`.

## Capturing a fixture

1. Run the app, reproduce the scenario in a terminal tab.
2. Trigger the save action (session context menu, or `__taiSaveRecording()` from
   devtools).
3. Scrub the file before committing: replace real hostnames, usernames, and
   absolute home paths. The bytes are raw terminal output — read the file.
4. Drop it in this directory as `<scenario>.jsonl` and add a replay test.

## Rules

- **Never re-chunk or pretty-print a fixture.** The chunk boundaries are the
  data. `_altScreenTail` in BlockSegmenter exists solely because escape
  sequences split across chunks; joining them makes the fixture test nothing.
- **Never hand-edit the base64 payloads.** Re-record instead.
- Recordings are raw and unredacted by design — redacting bytes would corrupt
  escape sequences. That is why step 3 above is a manual read-through, not an
  automated filter.
