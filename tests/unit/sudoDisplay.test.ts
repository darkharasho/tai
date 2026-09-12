import { describe, it, expect } from 'vitest';
import { hasPendingSudo, applySudoResolved, cancelPendingSudo } from '../../src/utils/sudoDisplay';
import type { DisplayItem } from '../../src/components/BlockList';

type SudoStatus = 'pending' | 'answered' | 'cancelled' | 'auto' | 'refused';
const sudo = (status: SudoStatus, requestId = 'r'): DisplayItem =>
  ({ type: 'sudo', id: `s-${status}-${requestId}`, requestId, prompt: '', status });
const newId = () => 'new-1';

describe('hasPendingSudo', () => {
  it('is true only while a sudo item is pending', () => {
    expect(hasPendingSudo([])).toBe(false);
    expect(hasPendingSudo([sudo('answered'), sudo('cancelled'), sudo('auto'), sudo('refused')])).toBe(false);
    expect(hasPendingSudo([sudo('answered'), sudo('pending')])).toBe(true);
  });
});

describe('applySudoResolved', () => {
  it('marks the pending item answered or cancelled', () => {
    expect(applySudoResolved([sudo('pending', 'req-1')], 'req-1', 'answered', newId))
      .toEqual([{ ...sudo('pending', 'req-1'), status: 'answered' }]);
    expect(applySudoResolved([sudo('pending', 'req-1')], 'req-1', 'cancelled', newId))
      .toEqual([{ ...sudo('pending', 'req-1'), status: 'cancelled' }]);
  });

  it('turns a pending field into a refused warning on a duplicate claim', () => {
    expect(applySudoResolved([sudo('pending', 'req-1')], 'req-1', 'refused-duplicate', newId))
      .toEqual([{ ...sudo('pending', 'req-1'), status: 'refused' }]);
  });

  it('appends a refused warning when no field was showing', () => {
    const items = [sudo('auto', '')];
    expect(applySudoResolved(items, 'req-1', 'refused-duplicate', newId)).toEqual([
      ...items,
      { type: 'sudo', id: 'new-1', requestId: 'req-1', prompt: '', status: 'refused' },
    ]);
  });

  it('ignores an answer or cancel for an unknown request', () => {
    const items = [sudo('answered', 'req-1')];
    expect(applySudoResolved(items, 'req-9', 'answered', newId)).toBe(items);
    expect(applySudoResolved(items, 'req-1', 'cancelled', newId)).toBe(items);
  });
});

describe('cancelPendingSudo', () => {
  it('marks every pending sudo item cancelled and leaves the rest alone', () => {
    const items = [sudo('pending', 'req-1'), sudo('answered', 'req-2'), sudo('pending', 'req-3')];
    expect(cancelPendingSudo(items)).toEqual([
      { ...sudo('pending', 'req-1'), status: 'cancelled' },
      sudo('answered', 'req-2'),
      { ...sudo('pending', 'req-3'), status: 'cancelled' },
    ]);
  });

  it('returns the same array when nothing is pending', () => {
    const items = [sudo('answered', 'req-1'), sudo('refused', 'req-2')];
    expect(cancelPendingSudo(items)).toBe(items);
  });
});
