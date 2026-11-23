import { summarize } from './summary'
import { calcRow } from './calc'
import { ITEMS } from '../data/items'
import type { BarReportRow, Item } from './types'
import type { ReportRecord } from '../storage/repo'

const BAR_ITEMS = ITEMS.filter((i) => i.form === 'bar')
const item25 = BAR_ITEMS.find((i) => i.sizeOz === 25)!
const item23 = BAR_ITEMS.find((i) => i.sizeOz === 23)!

const row = (itemCode: string, patch: Partial<BarReportRow> = {}): BarReportRow => ({
  itemCode,
  openBtl: 0,
  openOz: 0,
  dailyStore: 0,
  transferIn: 0,
  transferOut: 0,
  sale: 0,
  remark: '',
  ...patch,
})

const rec = (date: string, rows: BarReportRow[], status: 'draft' | 'saved' = 'saved'): ReportRecord => ({
  barId: 'the-cove',
  date,
  reportBy: '',
  status,
  rows,
})

describe('summarize', () => {
  it('returns [] for no records', () => {
    expect(summarize([], BAR_ITEMS)).toEqual([])
  })

  it('sums two days for one item; lastClosed is the latest date closed', () => {
    const day1 = row(item25.code, { openBtl: 2, dailyStore: 25, transferIn: 5, transferOut: 3, sale: 10.1 })
    const day2 = row(item25.code, { openBtl: 2, openOz: 17, dailyStore: 0, transferIn: 2.2, transferOut: 1, sale: 20.2 })
    // records arrive sorted by date asc from the repo, but summarize must not rely on it
    const out = summarize([rec('2026-11-02', [day2]), rec('2026-11-01', [day1])], BAR_ITEMS)
    expect(out).toHaveLength(1)
    const s = out[0]
    expect(s.code).toBe(item25.code)
    expect(s.name).toBe(item25.name)
    expect(s.category).toBe(item25.category)
    expect(s.sizeOz).toBe(25)
    expect(s.days).toBe(2)
    expect(s.totalIn).toBe(32.2) // 25 + 5 + 0 + 2.2
    expect(s.totalOut).toBe(4)
    expect(s.totalSale).toBe(30.3) // 10.1 + 20.2 without float noise
    expect(s.lastClosed).toBe(calcRow(day2, 25).closed)
    expect(s.dailyRows).toEqual([
      { date: '2026-11-01', closed: calcRow(day1, 25).closed, sale: 10.1 },
      { date: '2026-11-02', closed: calcRow(day2, 25).closed, sale: 20.2 },
    ])
  })

  it('excludes untouched rows and items with no touched rows', () => {
    const out = summarize(
      [
        rec('2026-11-01', [row(item25.code, { sale: 5, openBtl: 1 }), row(item23.code)]),
        rec('2026-11-03', [row(item25.code)]),
      ],
      BAR_ITEMS,
    )
    expect(out.map((s) => s.code)).toEqual([item25.code])
    expect(out[0].days).toBe(1)
    expect(out[0].lastClosed).toBe(20) // the untouched later day does not override
  })

  it('returns [] when every row is untouched', () => {
    expect(summarize([rec('2026-11-01', [row(item25.code), row(item23.code)])], BAR_ITEMS)).toEqual([])
  })

  it('excludes orphan item codes', () => {
    const out = summarize([rec('2026-11-01', [row('NOPE-999', { sale: 3 }), row(item23.code, { sale: 1 })])], BAR_ITEMS)
    expect(out.map((s) => s.code)).toEqual([item23.code])
  })

  it('includes draft records', () => {
    const out = summarize([rec('2026-11-01', [row(item23.code, { sale: 4 })], 'draft')], BAR_ITEMS)
    expect(out[0].totalSale).toBe(4)
  })

  it('sums a persisted touched row carrying openFrom normally', () => {
    const day1 = row(item25.code, { openBtl: 2, openOz: 3, openFrom: '2026-10-31', dailyStore: 4, transferIn: 1, transferOut: 2, sale: 6 })
    const out = summarize([rec('2026-11-01', [day1])], BAR_ITEMS)
    expect(out).toHaveLength(1)
    expect(out[0].days).toBe(1)
    expect(out[0].totalIn).toBe(5)
    expect(out[0].totalOut).toBe(2)
    expect(out[0].totalSale).toBe(6)
    expect(out[0].lastClosed).toBe(calcRow(day1, 25).closed)
    expect(out[0].lastClosed).toBe(50) // 53 + 4 + 1 − 2 − 6
  })

  it('orders by category then item order', () => {
    const items: Item[] = [
      { code: 'A1', name: 'a1', category: 'X', sizeOz: 10, form: 'bar' },
      { code: 'B1', name: 'b1', category: 'Y', sizeOz: 10, form: 'bar' },
      { code: 'A2', name: 'a2', category: 'X', sizeOz: 10, form: 'bar' },
    ]
    const out = summarize([rec('2026-11-01', [row('B1', { sale: 1 }), row('A2', { sale: 1 }), row('A1', { sale: 1 })])], items)
    expect(out.map((s) => s.code)).toEqual(['A1', 'A2', 'B1'])
  })
})
