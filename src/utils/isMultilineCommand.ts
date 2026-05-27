// True when the input contains an *interior* newline — i.e. the user is
// submitting more than one logical line. A trailing newline alone (from the
// input box's Enter-to-submit) doesn't count: it's just the submit marker,
// not extra content, so the value still represents a single command.
export function isMultilineCommand(value: string): boolean {
  return value.replace(/\n+$/, '').includes('\n');
}
