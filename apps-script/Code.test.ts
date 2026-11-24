// @ts-nocheck -- not part of the app tsconfig; loads Code.gs (plain Apps Script JS) in a Google-free vm.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const src = fs.readFileSync(path.join(__dirname, 'Code.gs'), 'utf8')
// Sandbox deliberately has NO Google globals (SpreadsheetApp, LockService, ...).
const ctx = vm.createContext({})
vm.runInContext(src, ctx)
const api = vm.runInContext(
  '({handleRequest, rowsToSheetValues, sheetValuesToRecords, BAR_IDS, ITEMS_SEED})',
  ctx,
)
const { handleRequest, rowsToSheetValues, sheetValuesToRecords } = api

const NOW = '2026-11-24T10:00:00.000Z'
const KEYS = { 'the-cove': 'key-cove', mango: 'key-mango' }

function row(over = {}) {
  return {
    itemCode: 'A1', openBtl: 1, openOz: 5, dailyStore: 0, transferIn: 0, transferOut: 0,
    sale: 3, remark: '', ...over,
  }
}

function makeStore(opts = {}) {
  const calls = []
  const data = { report: [], req: [] } // sheet values (no header)
  const items = opts.items || []
  const store = {
    calls, data,
    now() { calls.push('now'); return NOW },
    keyFor(barId) { calls.push('keyFor'); return KEYS[barId] || null },
    lock(fn) { calls.push('lock'); return fn() },
    upsertRecord(form, barId, date, rows, meta, nowIso) {
      calls.push('upsert')
      if (opts.throwOn === 'upsert') throw new Error('boom at Code.gs:99 secret-stack')
      data[form] = data[form].filter((r) => !(r[0] === barId && r[1] === date))
      if (rows.length) data[form].push(...rowsToSheetValues(form, barId, date, rows, meta, nowIso))
    },
    loadMonth(form, barId, month) {
      calls.push('loadMonth')
      if (opts.throwOn === 'load') throw new Error('boom at Code.gs:99 secret-stack')
      return sheetValuesToRecords(form, data[form], barId, month)
    },
    items() { calls.push('items'); return items },
  }
  return store
}

const req = (o) => JSON.stringify(o)
const push = (o = {}) => ({
  action: 'push', barId: 'the-cove', key: 'key-cove', form: 'report', date: '2026-11-20',
  rows: [row()], meta: { reportBy: 'Nok', status: 'saved', items: { A1: { name: 'Gin', category: 'Spirits' } } },
  ...o,
})

describe('auth', () => {
  it('missing key -> unauthorized, no store reads/writes', () => {
    const s = makeStore()
    const r = handleRequest(req(push({ key: undefined })), s)
    expect(r).toEqual({ ok: false, error: 'unauthorized' })
    expect(s.calls.filter((c) => c !== 'keyFor')).toEqual([])
  })
  it('wrong key -> unauthorized, never echoes the real key', () => {
    const s = makeStore()
    const r = handleRequest(req(push({ key: 'nope' })), s)
    expect(r).toEqual({ ok: false, error: 'unauthorized' })
    expect(JSON.stringify(r)).not.toContain('key-cove')
    expect(s.calls).not.toContain('lock')
    expect(s.calls).not.toContain('upsert')
  })
  it('unknown bar -> unauthorized', () => {
    const s = makeStore()
    expect(handleRequest(req(push({ barId: 'fm', key: 'x' })), s)).toEqual({ ok: false, error: 'unauthorized' })
  })
  it("bar A's key cannot push or load bar B", () => {
    const s = makeStore()
    expect(handleRequest(req(push({ barId: 'mango' })), s).error).toBe('unauthorized')
    expect(handleRequest(req({ action: 'load', barId: 'mango', key: 'key-cove', month: '2026-11' }), s).error).toBe('unauthorized')
    expect(handleRequest(req({ action: 'items', barId: 'mango', key: 'key-cove' }), s).error).toBe('unauthorized')
    expect(s.calls).not.toContain('upsert')
    expect(s.calls).not.toContain('loadMonth')
    expect(s.calls).not.toContain('items')
  })
})

describe('push', () => {
  it('replaces rows in ONE lock call and returns applied + serverUpdatedAt', () => {
    const s = makeStore()
    handleRequest(req(push({ rows: [row(), row({ itemCode: 'A2' })] })), s)
    s.calls.length = 0
    const r = handleRequest(req(push({ rows: [row({ itemCode: 'B1' })] })), s)
    expect(r).toEqual({ ok: true, applied: 1, serverUpdatedAt: NOW })
    expect(s.calls.filter((c) => c === 'lock')).toHaveLength(1)
    expect(s.calls.filter((c) => c === 'upsert')).toHaveLength(1)
    expect(s.data.report.map((r) => r[2])).toEqual(['B1'])
    expect(s.data.report[0][18]).toBe(NOW)
  })
  it('rows=[] clears the record (rows deleted, record disappears)', () => {
    const s = makeStore()
    handleRequest(req(push()), s)
    expect(s.data.report).toHaveLength(1)
    const r = handleRequest(req(push({ rows: [] })), s)
    expect(r).toEqual({ ok: true, applied: 0, serverUpdatedAt: NOW })
    expect(s.data.report).toHaveLength(0)
    const l = handleRequest(req({ action: 'load', barId: 'the-cove', key: 'key-cove', month: '2026-11' }), s)
    expect(l.reports).toEqual([])
  })
  it('does not touch other bars/dates/forms', () => {
    const s = makeStore()
    handleRequest(req(push()), s)
    handleRequest(req(push({ date: '2026-11-21' })), s)
    handleRequest(req(push({ barId: 'mango', key: 'key-mango' })), s)
    handleRequest(req(push({ rows: [row({ itemCode: 'Z' })] })), s)
    expect(s.data.report.map((r) => r[0] + r[1] + r[2]).sort()).toEqual(
      ['mango2026-11-20A1', 'the-cove2026-11-20Z', 'the-cove2026-11-21A1'].sort(),
    )
  })
  it('requisition round trip', () => {
    const s = makeStore()
    const body = {
      action: 'push', barId: 'the-cove', key: 'key-cove', form: 'req', date: '2026-11-20',
      rows: [{ itemCode: 'A1', qty: 3 }],
      meta: { requestedBy: 'a', approvedBy: 'b', issuedBy: 'c', status: 'saved', items: { A1: { name: 'Gin', category: 'x' } } },
    }
    expect(handleRequest(req(body), s).applied).toBe(1)
    const l = handleRequest(req({ action: 'load', barId: 'the-cove', key: 'key-cove', month: '2026-11' }), s)
    expect(l.reqs).toEqual([{
      barId: 'the-cove', date: '2026-11-20', requestedBy: 'a', approvedBy: 'b', issuedBy: 'c',
      status: 'saved', updatedAt: NOW, rows: [{ itemCode: 'A1', qty: 3 }],
    }])
  })
})

describe('load', () => {
  it('returns only the requested bar and month, grouped by date', () => {
    const s = makeStore()
    handleRequest(req(push({ date: '2026-11-20' })), s)
    handleRequest(req(push({ date: '2026-11-21', rows: [row(), row({ itemCode: 'A2' })] })), s)
    handleRequest(req(push({ date: '2026-10-31' })), s)
    handleRequest(req(push({ barId: 'mango', key: 'key-mango' })), s)
    const l = handleRequest(req({ action: 'load', barId: 'the-cove', key: 'key-cove', month: '2026-11' }), s)
    expect(l.ok).toBe(true)
    expect(l.reqs).toEqual([])
    expect(l.reports.map((r) => r.date)).toEqual(['2026-11-20', '2026-11-21'])
    expect(l.reports[1].rows.map((r) => r.itemCode)).toEqual(['A1', 'A2'])
    expect(l.reports[0]).toMatchObject({ barId: 'the-cove', reportBy: 'Nok', status: 'saved', updatedAt: NOW })
  })
  it('skips malformed rows', () => {
    const s = makeStore()
    handleRequest(req(push()), s)
    const good = s.data.report[0]
    s.data.report.push(['the-cove', '2026-11-20', '', 'x', 'c', '', 1, 1, 0, 0, 0, 1, '', '', '', '', 'saved', 'Nok', NOW]) // no itemCode
    s.data.report.push(['the-cove', '2026-11-20', 'Q', 'x', 'c', '', 'abc', 1, 0, 0, 0, 1, '', '', '', '', 'saved', 'Nok', NOW]) // NaN
    s.data.report.push(['the-cove', 'garbage', 'Q', 'x', 'c', '', 1, 1, 0, 0, 0, 1, '', '', '', '', 'saved', 'Nok', NOW]) // bad date
    s.data.report.push(['the-cove', '2026-11-20', 'Q', 'x', 'c', '', 1, 1, 0, 0, 0, 1, '', '', '', '', 'weird', 'Nok', NOW]) // bad status
    s.data.report.push(['short'])
    s.data.report.push(null)
    const l = handleRequest(req({ action: 'load', barId: 'the-cove', key: 'key-cove', month: '2026-11' }), s)
    expect(l.reports).toHaveLength(1)
    expect(l.reports[0].rows).toHaveLength(1)
    expect(good[2]).toBe('A1')
  })
})

describe('items', () => {
  it('returns only active items', () => {
    const items = [
      { code: 'A', name: 'a', category: 'c', form: 'bar', sizeOz: 25, active: true },
      { code: 'B', name: 'b', category: 'c', form: 'bar', sizeOz: 25, active: false },
      { code: 'C', name: 'c', category: 'c', form: 'requisition', active: undefined },
    ]
    const r = handleRequest(req({ action: 'items', barId: 'the-cove', key: 'key-cove' }), makeStore({ items }))
    expect(r.ok).toBe(true)
    expect(r.items.map((i) => i.code)).toEqual(['A', 'C'])
  })
})

describe('bad_request', () => {
  const s = () => makeStore()
  const bad = (b, st = s()) => handleRequest(typeof b === 'string' ? b : req(b), st)
  it('invalid JSON / non-object', () => {
    expect(bad('{nope')).toEqual({ ok: false, error: 'bad_request' })
    expect(bad('[1]').error).toBe('bad_request')
    expect(bad('null').error).toBe('bad_request')
    expect(handleRequest(undefined, s()).error).toBe('bad_request')
  })
  it('unknown action', () => {
    expect(bad({ action: 'drop', barId: 'the-cove', key: 'key-cove' }).error).toBe('bad_request')
  })
  it('bad barId / date / month / form / rows', () => {
    expect(bad(push({ barId: '../x' })).error).toBe('bad_request')
    expect(bad(push({ barId: 5 })).error).toBe('bad_request')
    expect(bad(push({ date: '2026-13-01' })).error).toBe('bad_request')
    expect(bad(push({ date: '2026-02-30' })).error).toBe('bad_request')
    expect(bad(push({ date: '20261120' })).error).toBe('bad_request')
    expect(bad(push({ form: 'x' })).error).toBe('bad_request')
    expect(bad(push({ rows: 'nope' })).error).toBe('bad_request')
    expect(bad(push({ rows: [null] })).error).toBe('bad_request')
    expect(bad(push({ rows: [row({ sale: 'x' })] })).error).toBe('bad_request')
    expect(bad(push({ rows: [row({ itemCode: '' })] })).error).toBe('bad_request')
    expect(bad({ action: 'load', barId: 'the-cove', key: 'key-cove', month: '2026-13' }).error).toBe('bad_request')
    expect(bad({ action: 'load', barId: 'the-cove', key: 'key-cove', month: '2026-1' }).error).toBe('bad_request')
  })
  it('rows over 500 and body too large; no writes happen', () => {
    const st = s()
    expect(bad(push({ rows: Array.from({ length: 501 }, () => row()) }), st).error).toBe('bad_request')
    expect(st.calls).not.toContain('upsert')
    expect(bad('{"a":"' + 'x'.repeat(2_000_000) + '"}').error).toBe('bad_request')
    expect(bad(push({ rows: Array.from({ length: 500 }, () => row()) })).ok).toBe(true)
  })
})

describe('server_error', () => {
  it('store throws on push/load -> generic error, no stack text', () => {
    for (const [throwOn, body] of [
      ['upsert', push()],
      ['load', { action: 'load', barId: 'the-cove', key: 'key-cove', month: '2026-11' }],
    ]) {
      const r = handleRequest(req(body), makeStore({ throwOn }))
      expect(r).toEqual({ ok: false, error: 'server_error' })
      expect(JSON.stringify(r)).not.toContain('boom')
    }
  })
})

describe('row mapping', () => {
  const meta = { reportBy: 'Nok', status: 'draft', items: { A1: { name: 'Gin', category: 'Spirits' } } }
  const roundTrip = (rows, m = meta) => {
    const vals = rowsToSheetValues('report', 'the-cove', '2026-11-20', rows, m, NOW)
    return sheetValuesToRecords('report', vals, 'the-cove', '2026-11')[0].rows
  }
  it('column order and renames', () => {
    const [v] = rowsToSheetValues('report', 'the-cove', '2026-11-20', [row({
      sizeOz: 25, openBtl: 2, openOz: 3, dailyStore: 4, transferIn: 5, transferOut: 6, sale: 7, countedBtl: 1, countedOz: 2, remark: 'r', openFrom: '2026-11-19',
    })], meta, NOW)
    expect(v).toEqual(['the-cove', '2026-11-20', 'A1', 'Gin', 'Spirits', 25, 2, 3, 4, 5, 6, 7, 1, 2, 'r', '2026-11-19', 'draft', 'Nok', NOW])
  })
  it('itemName/category empty when meta.items absent', () => {
    const [v] = rowsToSheetValues('report', 'b', '2026-11-20', [row()], { reportBy: 'x', status: 'saved' }, NOW)
    expect(v.slice(3, 5)).toEqual(['', ''])
  })
  it('counted 0 vs absent, sizeOz present vs absent, openFrom', () => {
    const [a, b, c] = roundTrip([
      row({ countedBtl: 0, countedOz: 0, sizeOz: 25, openFrom: '2026-11-19' }),
      row({ itemCode: 'A2' }),
      row({ itemCode: 'A3', countedBtl: 2 }),
    ])
    expect(a).toEqual(row({ countedBtl: 0, countedOz: 0, sizeOz: 25, openFrom: '2026-11-19' }))
    expect(b).toEqual(row({ itemCode: 'A2' }))
    expect('countedBtl' in b || 'sizeOz' in b || 'openFrom' in b).toBe(false)
    expect(c.countedBtl).toBe(2)
    expect(c.countedOz).toBeUndefined()
  })
  it('numbers stay numbers (also when sheet gives numeric strings)', () => {
    const vals = rowsToSheetValues('report', 'the-cove', '2026-11-20', [row({ sale: 2.5 })], meta, NOW)
    vals[0][11] = '2.5'
    const r = sheetValuesToRecords('report', vals, 'the-cove', '2026-11')[0].rows[0]
    expect(r.sale).toBe(2.5)
    expect(typeof r.openBtl).toBe('number')
  })
  it('Thai text, commas, newlines round trip', () => {
    const remark = 'เหล้าหมด, สั่งเพิ่ม\nบรรทัดสอง "quote"'
    const [r] = roundTrip([row({ remark })], { ...meta, reportBy: 'สมชาย' })
    expect(r.remark).toBe(remark)
    const rec = sheetValuesToRecords('report', rowsToSheetValues('report', 'the-cove', '2026-11-20', [row()], { ...meta, reportBy: 'สมชาย' }, NOW), 'the-cove', '2026-11')[0]
    expect(rec.reportBy).toBe('สมชาย')
  })
  it('text is never altered: =1+1, +1, -2, @x, \'x round trip unchanged (itemCode, names, remark, by)', () => {
    for (const t of ['=1+1', '+1', '-2', '@x', "'x"]) {
      const vals = rowsToSheetValues('report', 'the-cove', '2026-11-20', [row({ itemCode: t, remark: t })],
        { reportBy: t, status: 'saved', items: { [t]: { name: t, category: t } } }, NOW)
      expect(vals[0][2]).toBe(t); expect(vals[0][3]).toBe(t); expect(vals[0][14]).toBe(t)
      const rec = sheetValuesToRecords('report', vals, 'the-cove', '2026-11')[0]
      expect(rec.rows[0].itemCode).toBe(t)
      expect(rec.rows[0].remark).toBe(t)
      expect(rec.reportBy).toBe(t)
    }
  })
  it('0.1 and -0 survive', () => {
    const vals = rowsToSheetValues('report', 'b', '2026-11-20', [row({ sale: 0.1, openOz: -0 })], { status: 'saved' }, NOW)
    const r = sheetValuesToRecords('report', vals, 'b', '2026-11')[0].rows[0]
    expect(r.sale).toBe(0.1)
    expect(Object.is(r.openOz, -0)).toBe(true)
  })
  it('requisition column order', () => {
    const [v] = rowsToSheetValues('req', 'the-cove', '2026-11-20', [{ itemCode: 'A1', qty: 2 }],
      { requestedBy: 'a', approvedBy: 'b', issuedBy: 'c', status: 'saved', items: { A1: { name: 'Gin' } } }, NOW)
    expect(v).toEqual(['the-cove', '2026-11-20', 'A1', 'Gin', 2, 'a', 'b', 'c', 'saved', NOW])
  })
})

describe('constants', () => {
  it('BAR_IDS and ITEMS_SEED', () => {
    expect(Array.from(api.BAR_IDS)).toEqual(['the-cove', 'mango', 'coconut', 'fm', 'ct', 'palm', 'pn', 'pf-bb', 'bc', 'th-saya', 'pipin', 'ray-bar'])
    expect(Array.isArray(api.ITEMS_SEED)).toBe(true)
  })
})

describe('dedupe, busy, limits, helpers', () => {
  it('load dedupes (date,itemCode): last row wins, no double count', () => {
    const s = makeStore()
    handleRequest(req(push({ rows: [row({ itemCode: 'A1', sale: 1 }), row({ itemCode: 'A2' })] })), s)
    s.data.report.push(...rowsToSheetValues('report', 'the-cove', '2026-11-20', [row({ itemCode: 'A1', sale: 9 })], { reportBy: 'Nok', status: 'saved' }, '2026-11-24T11:00:00.000Z'))
    const l = handleRequest(req({ action: 'load', barId: 'the-cove', key: 'key-cove', month: '2026-11' }), s)
    expect(l.reports[0].rows.map((r) => [r.itemCode, r.sale])).toEqual([['A1', 9], ['A2', 3]])
    expect(l.reports[0].updatedAt).toBe('2026-11-24T11:00:00.000Z')
  })
  it('lock timeout -> busy (not server_error)', () => {
    const s = makeStore()
    s.lock = () => { throw { code: 'busy' } }
    expect(handleRequest(req(push()), s)).toEqual({ ok: false, error: 'busy' })
  })
  it('now() is taken inside the lock', () => {
    const s = makeStore()
    handleRequest(req(push()), s)
    expect(s.calls.indexOf('lock')).toBeLessThan(s.calls.indexOf('now'))
  })
  it('remark null accepted as empty', () => {
    const s = makeStore()
    expect(handleRequest(req(push({ rows: [row({ remark: null })] })), s).ok).toBe(true)
    expect(s.data.report[0][14]).toBe('')
  })
  it('limits: old dates, huge numbers rejected', () => {
    expect(handleRequest(req(push({ date: '0099-01-01' })), makeStore()).error).toBe('bad_request')
    expect(handleRequest(req(push({ date: '2101-01-01' })), makeStore()).error).toBe('bad_request')
    expect(handleRequest(req(push({ rows: [row({ sale: 1e9 })] })), makeStore()).error).toBe('bad_request')
    expect(handleRequest(req({ action: 'load', barId: 'the-cove', key: 'key-cove', month: '0099-01' }), makeStore()).error).toBe('bad_request')
    expect(handleRequest(req(push({ rows: [row({ sale: 1e7 })] })), makeStore()).ok).toBe(true)
  })
  it('pickKey_: skips blank, first non-blank wins, other bars ignored', () => {
    const { pickKey_ } = vm.runInContext('({pickKey_})', ctx)
    const rows = [['mango', 'm'], ['the-cove', ''], ['the-cove', '  '], ['the-cove', 'k1'], ['the-cove', 'k2']]
    expect(pickKey_(rows, 'the-cove')).toBe('k1')
    expect(pickKey_(rows, 'fm')).toBeNull()
    expect(pickKey_([['fm', '']], 'fm')).toBeNull()
  })
  it('matchRowNumbers_/toRuns_ collapse contiguous rows', () => {
    const { toRuns_, matchRowNumbers_ } = vm.runInContext('({toRuns_, matchRowNumbers_})', ctx)
    expect(JSON.parse(JSON.stringify(toRuns_([2, 3, 4, 7, 9, 10])))).toEqual([{ start: 2, count: 3 }, { start: 7, count: 1 }, { start: 9, count: 2 }])
    const ab = [['b', '2026-11-01'], ['x', '2026-11-01'], ['b', '2026-11-01'], ['b', '2026-12-01']]
    expect(Array.from(matchRowNumbers_(ab, (bar, d) => bar === 'b' && d === '2026-11-01'))).toEqual([2, 4])
  })
})
