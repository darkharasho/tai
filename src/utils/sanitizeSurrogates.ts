/**
 * Replace unpaired UTF-16 surrogate code units with U+FFFD (the replacement
 * character). Terminal output — especially from Windows ConPTY, where bytes
 * can be split across reads or mis-decoded — and naive string slicing (cutting
 * between a high and low surrogate) can leave lone surrogates in a JS string.
 * Those serialize to invalid JSON (`\uD83D` with no following `\uDCxx`), and
 * the Anthropic API rejects such a request body with
 * `400 ... no low surrogate in string`. Sanitizing before we send any
 * terminal-derived text to the model keeps the request body valid.
 */
export function stripLoneSurrogates(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      // High surrogate — valid only if immediately followed by a low surrogate.
      const next = s.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += s[i] + s[i + 1];
        i++;
      } else {
        out += '�';
      }
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      // Low surrogate with no preceding high surrogate.
      out += '�';
    } else {
      out += s[i];
    }
  }
  return out;
}
