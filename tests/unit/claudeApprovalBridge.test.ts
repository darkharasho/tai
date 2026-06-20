import { describe, it, expect } from 'vitest';
import { ApprovalBridge } from '../../electron/services/claudeApprovalBridge';

describe('ApprovalBridge', () => {
  it('resolve(true) settles the request as allow', async () => {
    const b = new ApprovalBridge();
    const p = b.request('t1');
    expect(b.resolve('t1', true)).toBe(true);
    expect(await p).toEqual({ behavior: 'allow' });
  });

  it('resolve(false) settles the request as deny with a message', async () => {
    const b = new ApprovalBridge();
    const p = b.request('t2');
    b.resolve('t2', false);
    const r = await p;
    expect(r.behavior).toBe('deny');
    expect((r as any).message).toBeTruthy();
  });

  it('resolve on an unknown id returns false', () => {
    const b = new ApprovalBridge();
    expect(b.resolve('nope', true)).toBe(false);
  });

  it('clear() denies all pending requests', async () => {
    const b = new ApprovalBridge();
    const p = b.request('t3');
    b.clear();
    expect((await p).behavior).toBe('deny');
    expect(b.resolve('t3', true)).toBe(false);
  });
});
