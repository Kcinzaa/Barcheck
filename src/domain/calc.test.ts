import { describe, it, expect } from 'vitest';
import { calcRow, isTouched } from './calc';
import type { BarReportRow } from './types';

const base: BarReportRow = {
  itemCode: 'X',
  openBtl: 0,
  openOz: 0,
  dailyStore: 0,
  transferIn: 0,
  transferOut: 0,
  sale: 0,
  remark: '',
};

describe('calcRow', () => {
  const row = { ...base, openBtl: 1, openOz: 8, sale: 10 };
  it('computes closed', () => {
    const r = calcRow(row, 25);
    expect(r.total1).toBe(33);
    expect(r.total2).toBe(33);
    expect(r.closed).toBe(23);
    expect(r.negative).toBe(false);
  });
  it('variance when counted', () => {
    expect(calcRow({ ...row, countedBtl: 0, countedOz: 22 }, 25).variance).toBe(-1);
  });
  it('variance when only bottles counted', () => {
    expect(calcRow({ ...row, countedBtl: 1 }, 25).variance).toBe(2);
  });
  it('null variance when not counted', () => {
    expect(calcRow(row, 25).variance).toBeNull();
  });
  it('negative flag', () => {
    expect(calcRow({ ...row, sale: 50 }, 25).negative).toBe(true);
  });
  it('transfers and store, no float noise', () => {
    const r = calcRow({ ...base, openOz: 0.1, dailyStore: 0.2, transferIn: 1, transferOut: 0.3 }, 25);
    expect(r.closed).toBe(1);
  });
});

describe('calcRow totals', () => {
  it('total1 includes transferIn, total2 subtracts transferOut', () => {
    const r = calcRow({ ...base, openOz: 33, dailyStore: 10, transferIn: 5, transferOut: 8, sale: 10 }, 25);
    expect(r.total1).toBe(48);
    expect(r.total2).toBe(40);
    expect(r.closed).toBe(30);
  });
});

describe('isTouched', () => {
  it('false for zero row', () => expect(isTouched(base)).toBe(false));
  it('true for remark only', () => expect(isTouched({ ...base, remark: 'x' })).toBe(true));
  it('true for sale', () => expect(isTouched({ ...base, sale: 1 })).toBe(true));
  it('true for counted', () => expect(isTouched({ ...base, countedOz: 0 })).toBe(true));
  it('true for open values without openFrom', () => expect(isTouched({ ...base, openBtl: 1 })).toBe(true));

  describe('with openFrom (prefilled Open)', () => {
    const pre: BarReportRow = { ...base, openBtl: 2, openOz: 3, openFrom: '2026-11-22' };
    it('false for openFrom + open values only', () => expect(isTouched(pre)).toBe(false));
    it('true once sale is set', () => expect(isTouched({ ...pre, sale: 1 })).toBe(true));
    it('true with any other signal', () => {
      expect(isTouched({ ...pre, dailyStore: 1 })).toBe(true);
      expect(isTouched({ ...pre, transferIn: 1 })).toBe(true);
      expect(isTouched({ ...pre, transferOut: 1 })).toBe(true);
      expect(isTouched({ ...pre, countedBtl: 0 })).toBe(true);
      expect(isTouched({ ...pre, countedOz: 0 })).toBe(true);
      expect(isTouched({ ...pre, remark: 'x' })).toBe(true);
    });
    it('false for whitespace-only remark', () => expect(isTouched({ ...pre, remark: '  ' })).toBe(false));
    it('a malformed openFrom is ignored, so open values count', () => {
      expect(isTouched({ ...pre, openFrom: '' })).toBe(true);
      expect(isTouched({ ...pre, openFrom: 'yesterday' })).toBe(true);
      expect(isTouched({ ...pre, openFrom: 20261122 as unknown as string })).toBe(true);
    });
  });
});
