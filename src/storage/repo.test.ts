import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { repo, type ReportRecord, type ReqRecord } from './repo'

const row = {
  itemCode: 'A1', openBtl: 1, openOz: 0, dailyStore: 0, transferIn: 0,
  transferOut: 0, sale: 2, remark: '',
}
const report = (barId: string, date: string, status: 'draft' | 'saved' = 'saved'): ReportRecord => ({
  barId, date, reportBy: 'amy', status, rows: [row],
})
const req = (barId: string, date: string, status: 'draft' | 'saved' = 'saved'): ReqRecord => ({
  barId, date, requestedBy: 'a', approvedBy: 'b', issuedBy: 'c', status,
  rows: [{ itemCode: 'A1', qty: 3 }],
})

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('repo', () => {
  it('saves then gets a report and a requisition', () => {
    repo.saveReport(report('pf', '2026-11-01'))
    repo.saveReq(req('pf', '2026-11-01'))
    expect(repo.getReport('pf', '2026-11-01')).toEqual({ ...report('pf', '2026-11-01'), updatedAt: expect.any(String) })
    expect(repo.getReq('pf', '2026-11-01')).toEqual({ ...req('pf', '2026-11-01'), updatedAt: expect.any(String) })
  })

  it('returns null when nothing is stored', () => {
    expect(repo.getReport('pf', '2026-11-01')).toBeNull()
    expect(repo.getReq('pf', '2026-11-01')).toBeNull()
  })

  it('replaces on repeated save of the same key', () => {
    repo.saveReport(report('pf', '2026-11-01', 'draft'))
    repo.saveReport(report('pf', '2026-11-01', 'saved'))
    expect(repo.getReport('pf', '2026-11-01')?.status).toBe('saved')
    expect(Object.keys(localStorage).filter((k) => k.startsWith('barcheck:report:'))).toHaveLength(1)
  })

  it('listReports returns only the month, sorted by date, ignoring corrupt entries', () => {
    repo.saveReport(report('pf', '2026-11-05'))
    repo.saveReport(report('pf', '2026-11-02'))
    repo.saveReport(report('pf', '2026-10-30'))
    repo.saveReport(report('pf', '2026-12-01'))
    localStorage.setItem('barcheck:report:pf:2026-11-03', '{bad')
    expect(repo.listReports('pf', '2026-11').map((r) => r.date)).toEqual(['2026-11-02', '2026-11-05'])
  })

  it('listReports does not match another bar sharing an id prefix', () => {
    repo.saveReport(report('pf', '2026-11-01'))
    repo.saveReport(report('pf-bb', '2026-11-02'))
    expect(repo.listReports('pf', '2026-11').map((r) => r.barId)).toEqual(['pf'])
    expect(repo.listReports('pf-bb', '2026-11').map((r) => r.barId)).toEqual(['pf-bb'])
  })

  it('statusFor reports none, draft, saved per form', () => {
    expect(repo.statusFor('pf', '2026-11-01')).toEqual({ report: 'none', req: 'none' })
    repo.saveReport(report('pf', '2026-11-01', 'draft'))
    repo.saveReq(req('pf', '2026-11-01', 'saved'))
    expect(repo.statusFor('pf', '2026-11-01')).toEqual({ report: 'draft', req: 'saved' })
  })

  it('returns null for corrupt JSON', () => {
    localStorage.setItem('barcheck:report:pf:2026-11-01', '{not json')
    localStorage.setItem('barcheck:req:pf:2026-11-01', 'nope')
    expect(repo.getReport('pf', '2026-11-01')).toBeNull()
    expect(repo.getReq('pf', '2026-11-01')).toBeNull()
    expect(repo.statusFor('pf', '2026-11-01')).toEqual({ report: 'none', req: 'none' })
  })

  it('rejects malformed rows and wrong shapes like missing records', () => {
    const k = 'barcheck:report:pf:2026-11-01'
    for (const bad of ['{"rows":"x"}', '{}', '[]', 'null', JSON.stringify({ ...report('pf', '2026-11-01'), rows: [null] }), JSON.stringify({ ...report('pf', '2026-11-01'), status: 'weird' })]) {
      localStorage.setItem(k, bad)
      localStorage.setItem('barcheck:req:pf:2026-11-01', bad)
      expect(repo.getReport('pf', '2026-11-01')).toBeNull()
      expect(repo.getReq('pf', '2026-11-01')).toBeNull()
      expect(repo.listReports('pf', '2026-11')).toEqual([])
      expect(repo.statusFor('pf', '2026-11-01')).toEqual({ report: 'none', req: 'none' })
    }
  })

  it('rejects records whose barId or date disagree with the key', () => {
    localStorage.setItem('barcheck:report:pf:2026-11-01', JSON.stringify(report('other', '2026-11-01')))
    localStorage.setItem('barcheck:report:pf:2026-11-02', JSON.stringify(report('pf', '2026-12-02')))
    localStorage.setItem('barcheck:req:pf:2026-11-01', JSON.stringify(req('pf', '2026-11-09')))
    expect(repo.getReport('pf', '2026-11-01')).toBeNull()
    expect(repo.getReq('pf', '2026-11-01')).toBeNull()
    expect(repo.listReports('pf', '2026-11')).toEqual([])
    expect(repo.listReports('pf', '2026-12')).toEqual([])
  })

  it('does not throw when setItem fails (quota/security)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    expect(() => repo.saveReport(report('pf', '2026-11-01'))).not.toThrow()
    expect(() => repo.saveReq(req('pf', '2026-11-01'))).not.toThrow()
  })

  it('does not throw when getItem fails', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError')
    })
    expect(repo.getReport('pf', '2026-11-01')).toBeNull()
    expect(repo.getReq('pf', '2026-11-01')).toBeNull()
    expect(repo.listReports('pf', '2026-11')).toEqual([])
  })

  it('round-trips a row carrying openFrom', () => {
    const r = { ...report('pf', '2026-11-02'), rows: [{ ...row, openFrom: '2026-11-01' }] }
    repo.saveReport(r)
    expect(repo.getReport('pf', '2026-11-02')).toEqual({ ...r, updatedAt: expect.any(String) })
  })
})

describe('repo.latestTouchedBefore', () => {
  const r = (itemCode: string, patch: Record<string, unknown> = {}) => ({ ...row, itemCode, ...patch })
  const put = (barId: string, date: string, rows: unknown[], status: 'draft' | 'saved' = 'saved') =>
    localStorage.setItem(`barcheck:report:${barId}:${date}`, JSON.stringify({ barId, date, reportBy: '', status, rows }))

  it('returns {} when nothing is stored', () => {
    expect(repo.latestTouchedBefore('pf', '2026-11-02')).toEqual({})
  })

  it('returns the latest touched row per item across a month boundary', () => {
    put('pf', '2026-10-29', [r('A1', { sale: 1 }), r('B2', { sale: 9 })])
    put('pf', '2026-10-31', [r('A1', { sale: 3 })])
    put('pf', '2026-11-01', [r('B2', { sale: 4 }), r('C3', { sale: 0, openBtl: 0 })]) // C3 untouched
    const out = repo.latestTouchedBefore('pf', '2026-11-02')
    expect(Object.keys(out).sort()).toEqual(['A1', 'B2'])
    expect(out.A1.date).toBe('2026-10-31')
    expect(out.A1.row.sale).toBe(3)
    expect(out.B2.date).toBe('2026-11-01')
    expect(out.B2.row.sale).toBe(4)
  })

  it('skips untouched rows and falls back to an earlier touched one', () => {
    put('pf', '2026-11-01', [r('A1', { sale: 2 })])
    put('pf', '2026-11-02', [r('A1', { openBtl: 0, sale: 0 })])
    expect(repo.latestTouchedBefore('pf', '2026-11-03').A1.date).toBe('2026-11-01')
  })

  it('a prefilled-only row (openFrom + open) is untouched and skipped', () => {
    put('pf', '2026-11-01', [r('A1', { sale: 2 })])
    put('pf', '2026-11-02', [r('A1', { openBtl: 5, sale: 0, openFrom: '2026-11-01' })])
    expect(repo.latestTouchedBefore('pf', '2026-11-03').A1.date).toBe('2026-11-01')
  })

  it('ignores same-day and later dates', () => {
    put('pf', '2026-11-02', [r('A1', { sale: 2 })])
    put('pf', '2026-11-03', [r('A1', { sale: 3 })])
    put('pf', '2026-12-01', [r('B2', { sale: 3 })])
    expect(repo.latestTouchedBefore('pf', '2026-11-02')).toEqual({})
    expect(repo.latestTouchedBefore('pf', '2026-11-03').A1.date).toBe('2026-11-02')
  })

  it('includes drafts', () => {
    put('pf', '2026-11-01', [r('A1', { sale: 2 })], 'saved')
    put('pf', '2026-11-02', [r('A1', { sale: 5 })], 'draft')
    expect(repo.latestTouchedBefore('pf', '2026-11-03').A1).toMatchObject({ date: '2026-11-02', row: { sale: 5 } })
  })

  it('does not read another bar, even one sharing an id prefix', () => {
    put('pf-bb', '2026-11-01', [r('A1', { sale: 2 })])
    put('other', '2026-11-01', [r('A1', { sale: 2 })])
    expect(repo.latestTouchedBefore('pf', '2026-11-02')).toEqual({})
  })

  it('skips corrupt records', () => {
    put('pf', '2026-10-30', [r('A1', { sale: 1 })])
    localStorage.setItem('barcheck:report:pf:2026-10-31', '{bad')
    localStorage.setItem('barcheck:report:pf:2026-11-01', JSON.stringify({ barId: 'other', date: '2026-11-01', status: 'saved', rows: [r('A1', { sale: 7 })] }))
    localStorage.setItem('barcheck:report:pf:2026-11-02', JSON.stringify({ barId: 'pf', date: '2026-10-01', status: 'saved', rows: [r('A1', { sale: 7 })] }))
    localStorage.setItem('barcheck:report:pf:2026-11-03', JSON.stringify({ barId: 'pf', date: '2026-11-03', status: 'weird', rows: [r('A1', { sale: 7 })] }))
    localStorage.setItem('barcheck:report:pf:2026-11-04', JSON.stringify({ barId: 'pf', date: '2026-11-04', status: 'saved', rows: [null] }))
    localStorage.setItem('barcheck:report:pf:junk', JSON.stringify({ barId: 'pf', date: 'junk', status: 'saved', rows: [r('A1', { sale: 7 })] }))
    expect(repo.latestTouchedBefore('pf', '2026-11-05')).toEqual({ A1: { date: '2026-10-30', row: r('A1', { sale: 1 }) } })
  })

  it('returns sanitized rows: garbage fields never crash or become NaN; malformed openFrom is dropped', () => {
    put('pf', '2026-11-01', [
      { itemCode: 'A1', sale: 5 }, // missing fields
      { itemCode: 'B2', openOz: 'bad', sale: 'x', remark: 3, transferIn: 2 },
      r('C3', { sale: 1, openFrom: 42 }),
      r('D4', { sale: 1, openFrom: '2026-02-30' }),
      r('E5', { sale: 1, openFrom: '2026-10-31' }),
    ])
    const out = repo.latestTouchedBefore('pf', '2026-11-02')
    expect(out.A1.row).toEqual({ itemCode: 'A1', openBtl: 0, openOz: 0, dailyStore: 0, transferIn: 0, transferOut: 0, sale: 5, remark: '' })
    expect(out.B2.row).toEqual({ itemCode: 'B2', openBtl: 0, openOz: 0, dailyStore: 0, transferIn: 2, transferOut: 0, sale: 0, remark: '' })
    expect('openFrom' in out.C3.row).toBe(false)
    expect('openFrom' in out.D4.row).toBe(false)
    expect(out.E5.row.openFrom).toBe('2026-10-31')
  })

  it('returns {} when storage throws', () => {
    put('pf', '2026-11-01', [r('A1', { sale: 2 })])
    vi.spyOn(Storage.prototype, 'key').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError')
    })
    expect(repo.latestTouchedBefore('pf', '2026-11-02')).toEqual({})
    vi.restoreAllMocks()
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError')
    })
    expect(repo.latestTouchedBefore('pf', '2026-11-02')).toEqual({})
  })
})

describe('repo write result', () => {
  it('returns true when the value is written', () => {
    expect(repo.saveReport(report('pf', '2026-11-01'))).toBe(true)
    expect(repo.saveReq(req('pf', '2026-11-01'))).toBe(true)
  })

  it('returns false when setItem throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    expect(repo.saveReport(report('pf', '2026-11-01'))).toBe(false)
    expect(repo.saveReq(req('pf', '2026-11-01'))).toBe(false)
  })
})

describe('updatedAt, onSaved, mergeRemote', () => {
  const offs: (() => void)[] = []
  afterEach(() => offs.splice(0).forEach((f) => f()))

  const failing = () =>
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })

  it('saveReport/saveReq set updatedAt on success', () => {
    expect(repo.saveReport(report('pf', '2026-11-01'))).toBe(true)
    expect(repo.saveReq(req('pf', '2026-11-01'))).toBe(true)
    const a = repo.getReport('pf', '2026-11-01')!.updatedAt!
    const b = repo.getReq('pf', '2026-11-01')!.updatedAt!
    expect(new Date(a).toISOString()).toBe(a)
    expect(new Date(b).toISOString()).toBe(b)
  })

  it('does not set updatedAt on a failed write', () => {
    failing()
    const r = report('pf', '2026-11-01')
    expect(repo.saveReport(r)).toBe(false)
    expect(r.updatedAt).toBeUndefined()
  })

  it('onSaved fires once per successful save with form/barId/date', () => {
    const fn = vi.fn()
    const off = repo.onSaved(fn)
    offs.push(off)
    repo.saveReport(report('pf', '2026-11-01'))
    repo.saveReq(req('pf', '2026-11-02'))
    expect(fn).toHaveBeenCalledTimes(2)
    expect(fn).toHaveBeenNthCalledWith(1, { form: 'report', barId: 'pf', date: '2026-11-01' })
    expect(fn).toHaveBeenNthCalledWith(2, { form: 'req', barId: 'pf', date: '2026-11-02' })
    off()
    repo.saveReport(report('pf', '2026-11-03'))
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('onSaved does not fire on a failed write', () => {
    const fn = vi.fn()
    const off = repo.onSaved(fn)
    offs.push(off)
    failing()
    repo.saveReport(report('pf', '2026-11-01'))
    repo.saveReq(req('pf', '2026-11-01'))
    expect(fn).not.toHaveBeenCalled()
    off()
  })

  it('a throwing listener does not break the save or other listeners', () => {
    const bad = vi.fn(() => { throw new Error('boom') })
    const good = vi.fn()
    offs.push(repo.onSaved(bad), repo.onSaved(good))
    expect(repo.saveReport(report('pf', '2026-11-01'))).toBe(true)
    expect(good).toHaveBeenCalledTimes(1)
    expect(repo.getReport('pf', '2026-11-01')).not.toBeNull()
  })

  it('mergeRemote replaces, keeps incoming updatedAt, and never fires onSaved', () => {
    const fn = vi.fn()
    const off = repo.onSaved(fn)
    offs.push(off)
    repo.saveReport(report('pf', '2026-11-01', 'draft'))
    fn.mockClear()
    const incoming = { ...report('pf', '2026-11-01', 'saved'), updatedAt: '2026-01-01T00:00:00.000Z' }
    expect(repo.mergeRemote('report', incoming, new Set())).toBe(true)
    expect(repo.getReport('pf', '2026-11-01')).toEqual(incoming)
    const rq = { ...req('pf', '2026-11-01'), updatedAt: '2026-01-02T00:00:00.000Z' }
    expect(repo.mergeRemote('req', rq, new Set())).toBe(true)
    expect(repo.getReq('pf', '2026-11-01')).toEqual(rq)
    expect(fn).not.toHaveBeenCalled()
    off()
  })

  it('mergeRemote skips when the key is pending', () => {
    repo.saveReport(report('pf', '2026-11-01', 'draft'))
    const incoming = report('pf', '2026-11-01', 'saved')
    expect(repo.mergeRemote('report', incoming, new Set(['report:pf:2026-11-01']))).toBe(false)
    expect(repo.getReport('pf', '2026-11-01')!.status).toBe('draft')
    // other keys / other form do not block
    expect(repo.mergeRemote('report', incoming, new Set(['req:pf:2026-11-01']))).toBe(true)
  })

  it('mergeRemote skips malformed records', () => {
    const bad = [
      null,
      { barId: 'pf', date: '2026-11-01', status: 'x', rows: [] },
      { barId: 'pf', date: '2026-11-01', status: 'saved', rows: 'no' },
      { barId: 'pf', date: '2026-11-01', status: 'saved', rows: [{ qty: 1 }] },
      { barId: 'pf', date: 'nope', status: 'saved', rows: [] },
    ]
    for (const b of bad) expect(repo.mergeRemote('report', b as never, new Set())).toBe(false)
    expect(repo.mergeRemote('req', { ...req('pf', '2026-11-01'), rows: [{ itemCode: 'A', qty: 'x' }] } as never, new Set())).toBe(false)
    expect(localStorage.length).toBe(0)
  })

  it('mergeRemote returns false when the write fails', () => {
    failing()
    expect(repo.mergeRemote('report', report('pf', '2026-11-01'), new Set())).toBe(false)
  })
})
