import { beforeEach, describe, expect, it, vi } from 'vitest'
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
    expect(repo.getReport('pf', '2026-11-01')).toEqual(report('pf', '2026-11-01'))
    expect(repo.getReq('pf', '2026-11-01')).toEqual(req('pf', '2026-11-01'))
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
})
