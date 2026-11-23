import { describe, it, expect } from 'vitest'
import { carryOpen } from './carry'
import type { BarReportRow } from './types'

const base: BarReportRow = {
  itemCode: 'X',
  openBtl: 0,
  openOz: 0,
  dailyStore: 0,
  transferIn: 0,
  transferOut: 0,
  sale: 0,
  remark: '',
}

describe('carryOpen', () => {
  it('carries the computed closed when nothing was counted', () => {
    // 1 btl 8 oz − 10 oz sale = 23 oz on a 25 oz bottle
    expect(carryOpen({ ...base, openBtl: 1, openOz: 8, sale: 10 }, 25)).toEqual({ openBtl: 0, openOz: 23 })
  })

  it('includes store and transfers in the computed closed', () => {
    const row = { ...base, openBtl: 1, dailyStore: 25, transferIn: 5, transferOut: 3, sale: 2 }
    expect(carryOpen(row, 25)).toEqual({ openBtl: 2, openOz: 0 })
  })

  it('uses the counted value over the computed closed', () => {
    const row = { ...base, openBtl: 1, openOz: 8, sale: 10, countedBtl: 0, countedOz: 20 }
    expect(carryOpen(row, 25)).toEqual({ openBtl: 0, openOz: 20 })
  })

  it('counted with only bottles set counts the oz as 0', () => {
    expect(carryOpen({ ...base, openBtl: 3, sale: 1, countedBtl: 1 }, 25)).toEqual({ openBtl: 1, openOz: 0 })
  })

  it('counted 0 is a real count (carries 0, not the computed closed)', () => {
    expect(carryOpen({ ...base, openBtl: 2, countedOz: 0 }, 25)).toEqual({ openBtl: 0, openOz: 0 })
  })

  it('negative computed closed is carried as 0', () => {
    expect(carryOpen({ ...base, openOz: 5, sale: 10 }, 25)).toEqual({ openBtl: 0, openOz: 0 })
  })

  it('normalises 30 oz on a 23 oz bottle to 1 btl 7 oz', () => {
    expect(carryOpen({ ...base, openOz: 30 }, 23)).toEqual({ openBtl: 1, openOz: 7 })
  })

  it('has no float noise', () => {
    expect(carryOpen({ ...base, openOz: 10.3, sale: 0.1 }, 25)).toEqual({ openBtl: 0, openOz: 10.2 })
  })

  it('a source row that was itself prefilled still counts its open values', () => {
    const row = { ...base, openBtl: 1, openOz: 0, openFrom: '2026-11-01', sale: 5 }
    expect(carryOpen(row, 25)).toEqual({ openBtl: 0, openOz: 20 })
  })
})
