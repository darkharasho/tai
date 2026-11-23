import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { guardStdio } from '../../electron/services/stdioGuard';

function err(code: string) {
  return Object.assign(new Error(`write ${code}`), { code });
}

describe('guardStdio', () => {
  it('swallows EPIPE from a closed stdout instead of crashing', () => {
    const s = new EventEmitter();
    guardStdio([s]);
    expect(() => s.emit('error', err('EPIPE'))).not.toThrow();
    expect(() => s.emit('error', err('EIO'))).not.toThrow();
  });

  it('still surfaces unexpected stream errors', () => {
    const s = new EventEmitter();
    guardStdio([s]);
    expect(() => s.emit('error', err('EACCES'))).toThrow('EACCES');
  });
});
