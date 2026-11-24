import { describe, it, expect } from 'vitest'
import { sanitizeRow } from './row'
import type { BarReportRow } from './types'

const base: BarReportRow = {
  itemCode: 'X', openBtl: 0, openOz: 0, dailyStore: 0, transferIn: 0, transferOut: 0, sale: 1, remark: '',
}
const withSize = (sizeOz: unknown) => ({ ...base, sizeOz } as BarReportRow)

describe('sanitizeRow sizeOz', () => {
  it('keeps a finite positive sizeOz', () => {
    expect(sanitizeRow(withSize(25)).sizeOz).toBe(25)
  })
  it.each([0, -3, NaN, Infinity, 'x', null])('drops sizeOz %s', (v) => {
    const out = sanitizeRow(withSize(v))
    expect(out.sizeOz).toBeUndefined()
    expect('sizeOz' in out).toBe(false)
  })
  it('leaves rows without sizeOz unchanged', () => {
    expect(sanitizeRow(base)).toEqual(base)
  })
})
