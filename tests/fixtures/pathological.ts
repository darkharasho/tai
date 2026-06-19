// Adversarial terminal inputs for robustness regression tests.
const ESC = '\x1b';
export const pathological = {
  binarySpew: Array.from({ length: 4096 }, (_, i) => String.fromCharCode(i % 256)).join(''),
  nulBytes: 'before\x00\x00\x00after',
  invalidUtf8: '\xff\xfe\xfd valid tail',
  hugeLine: 'x'.repeat(10_000_000),
  unterminatedOsc: `${ESC}]6973;` + 'A'.repeat(200_000),
  unterminatedDcs: `${ESC}P` + 'B'.repeat(200_000),
  cursorBomb: `${ESC}[999999B${ESC}[999999C done`,
  insertLineBomb: `${ESC}[999999L done`,
  nestedSgr: `${ESC}[1;2;3;4;5;6;7;38;5;200;48;5;100m`.repeat(2000) + 'text',
  belFlood: '\x07'.repeat(50_000) + 'tail',
};
