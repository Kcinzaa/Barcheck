import { exportFileName, toSheets } from './xlsx'
import type { SummaryRow } from '../domain/summary'

const rows: SummaryRow[] = [
  {
    code: 'B001',
    name: 'CAMPARI',
    category: 'APERITIFS',
    sizeOz: 25,
    days: 2,
    totalIn: 30,
    totalOut: 4,
    totalSale: 30.3,
    avgDailySale: 15.2,
    lastClosed: 57.5,
    lastSizeOz: 25,
    dailyRows: [
      { date: '2026-11-01', closed: 66.9, sale: 10.1, sizeOz: 25 },
      { date: '2026-11-02', closed: 57.5, sale: 20.2, sizeOz: 25 },
    ],
  },
  {
    code: 'B002',
    name: 'FERNET BRANCA',
    category: 'APERITIFS',
    sizeOz: 23,
    days: 1,
    totalIn: 0,
    totalOut: 0,
    totalSale: 9,
    avgDailySale: 4.5,
    lastClosed: -9,
    lastSizeOz: 23,
    dailyRows: [{ date: '2026-11-02', closed: -9, sale: 9, sizeOz: 23 }],
  },
]

describe('toSheets', () => {
  it('builds a header plus one numeric row per item for Summary', () => {
    const { summary } = toSheets('The Cove', '2026-11', rows)
    expect(summary).toHaveLength(1 + rows.length)
    expect(summary[0].every((h) => typeof h === 'string')).toBe(true)
    const header = summary[0] as string[]
    const col = (label: RegExp) => header.findIndex((h) => label.test(h))
    const r = summary[1]
    expect(r[col(/Code/)]).toBe('B001')
    expect(r[col(/^Days/)]).toBe(2)
    expect(r[col(/^In/)]).toBe(30)
    expect(r[col(/^Out/)]).toBe(4)
    expect(r[col(/^Sale/)]).toBe(30.3)
    expect(r[col(/^Closed \(oz\)/)]).toBe(57.5)
    expect(header[col(/^Sale/) + 1]).toBe('ขายเฉลี่ย/วัน (oz)')
    expect(r[col(/^Sale/) + 1]).toBe(15.2)
    expect(typeof r[col(/^Sale/) + 1]).toBe('number')
    expect(summary[2][col(/^Sale/) + 1]).toBe(4.5)
    expect(r[col(/^Closed bottles/)]).toBe(2)
    expect(r[col(/^Closed \+oz/)]).toBe(7.5)
    for (const i of [col(/^Days/), col(/^In/), col(/^Out/), col(/^Sale/), col(/^Closed/)]) {
      expect(typeof r[i]).toBe('number')
    }
    // negative closed splits so bottles * size + oz still equals the total
    const neg = summary[2]
    expect((neg[col(/^Closed bottles/)] as number) * 23 + (neg[col(/^Closed \+oz/)] as number)).toBe(-9)
  })

  it('builds one Daily row per item per day', () => {
    const { daily } = toSheets('The Cove', '2026-11', rows)
    expect(daily).toHaveLength(1 + 3)
    expect(daily[1]).toEqual(['2026-11-01', 'B001', 'CAMPARI', 10.1, 66.9])
    expect(daily[3]).toEqual(['2026-11-02', 'B002', 'FERNET BRANCA', 9, -9])
  })
})

describe('exportFileName', () => {
  it('sanitises the bar name', () => {
    expect(exportFileName('PF&BB', '2026-11')).toBe('barcheck-PF-BB-2026-11.xlsx')
    expect(exportFileName('Ray Bar', '2026-11')).toBe('barcheck-Ray-Bar-2026-11.xlsx')
    expect(exportFileName('TH&Saya', '2026-11')).toBe('barcheck-TH-Saya-2026-11.xlsx')
  })
})

describe('toSheets closed split at snapshot size', () => {
  it('splits Closed bottles/oz at lastSizeOz, not the item size', () => {
    const r: SummaryRow = { ...rows[0], sizeOz: 23, lastSizeOz: 25, lastClosed: 30 }
    const { summary } = toSheets('b', '2026-11', [r])
    const line = summary[1]
    expect(line.slice(-3)).toEqual([30, 1, 5])
  })
})
