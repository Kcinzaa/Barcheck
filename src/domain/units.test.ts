import { describe, it, expect } from 'vitest';
import { toOz, fromOz, parseNum } from './units';

describe('toOz', () => {
  it('converts bottles + oz', () => {
    expect(toOz(1, 8, 25)).toBe(33);
  });
});

describe('fromOz', () => {
  it('splits into bottles and oz', () => {
    expect(fromOz(30, 23)).toEqual({ bottles: 1, oz: 7 });
  });
  it('keeps negatives as oz with 0 bottles', () => {
    expect(fromOz(-5, 23)).toEqual({ bottles: 0, oz: -5 });
  });
  it('handles float noise', () => {
    expect(fromOz(0.1 + 0.2, 25)).toEqual({ bottles: 0, oz: 0.3 });
    expect(fromOz(46, 23)).toEqual({ bottles: 2, oz: 0 });
  });
  it('handles zero/invalid size', () => {
    expect(fromOz(10, 0)).toEqual({ bottles: 0, oz: 10 });
    expect(fromOz(10, NaN)).toEqual({ bottles: 0, oz: 10 });
  });
});

describe('parseNum', () => {
  it('parses comma decimal', () => expect(parseNum('7,5')).toBe(7.5));
  it('blank is 0', () => expect(parseNum('')).toBe(0));
  it('invalid is 0', () => expect(parseNum('abc')).toBe(0));
});
