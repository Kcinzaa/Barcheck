import { beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { createClient } from './client'
import { buildPayload } from './engine'
import type { ReportRecord, ReqRecord } from '../storage/repo'

type Store = {
  keyFor(barId: string): string | null
  now(): string
  lock<T>(fn: () => T): T
  upsertRecord(form: string, barId: string, date: string, rows: unknown[], meta: unknown, nowIso: string): void
  loadMonth(form: string, barId: string, month: string): unknown[]
  items(): unknown[]
}
type Api = {
  handleRequest(body: string, store: Store): unknown
  rowsToSheetValues(form: string, barId: string, date: string, rows: unknown[], meta: unknown, nowIso: string): unknown[][]
  sheetValuesToRecords(form: string, values: unknown[][], barId: string, month: string): unknown[]
}

const src = fs.readFileSync(path.join(__dirname, '../../apps-script/Code.gs'), 'utf8')
const ctx = vm.createContext({})
vm.runInContext(src, ctx)
const api = vm.runInContext('({handleRequest, rowsToSheetValues, sheetValuesToRecords})', ctx) as Api

function makeStore() {
  const data: Record<string, unknown[][]> = { report: [], req: [] }
  const store: Store = {
    keyFor: (b) => (b === 'the-cove' ? 'K' : null),
    now: () => '2026-11-24T10:00:00.000Z',
    lock: (fn) => fn(),
    upsertRecord(form, barId, date, rows, meta, nowIso) {
      data[form] = data[form].filter((r) => !(r[0] === barId && r[1] === date))
      if (rows.length) data[form].push(...api.rowsToSheetValues(form, barId, date, rows, meta, nowIso))
    },
    loadMonth: (form, barId, month) => api.sheetValuesToRecords(form, data[form], barId, month),
    items: () => [],
  }
  return store
}

// A fetch that talks straight to handleRequest.
const serverFetch = (store: Store) =>
  (async (_u: unknown, init?: RequestInit) => {
    const out = api.handleRequest(init?.body as string, store)
    return { ok: true, status: 200, text: async () => JSON.stringify(out) } as unknown as Response
  }) as unknown as typeof fetch

beforeEach(() => localStorage.clear())

describe('client payloads against Code.gs handleRequest', () => {
  it('report round-trips push -> load', async () => {
    vi.resetModules()
    const store = makeStore()
    const client = createClient({ url: 'u', keys: { 'the-cove': 'K' } }, serverFetch(store))
    const rec: ReportRecord = {
      barId: 'the-cove', date: '2026-11-20', reportBy: 'Nok', status: 'saved',
      rows: [
        { itemCode: 'A1', openBtl: 2, openOz: 5.5, dailyStore: 1, transferIn: 2, transferOut: 3, sale: 4, remark: '=1+1', sizeOz: 25, countedBtl: 1, countedOz: 3, openFrom: '2026-11-19' },
        { itemCode: 'B2', openBtl: 0, openOz: 0, dailyStore: 0, transferIn: 0, transferOut: 0, sale: 0, remark: '' },
      ],
    }
    const built = buildPayload('report', rec)
    await client.push({ form: 'report', barId: rec.barId, date: rec.date }, built)
    const loaded = await client.load('the-cove', '2026-11')
    expect(loaded.reports).toHaveLength(1)
    const got = loaded.reports[0]
    expect(got).toMatchObject({ barId: 'the-cove', date: '2026-11-20', reportBy: 'Nok', status: 'saved' })
    expect(got.rows).toEqual(rec.rows)
  })

  it('requisition round-trips and empty rows delete', async () => {
    const store = makeStore()
    const client = createClient({ url: 'u', keys: { 'the-cove': 'K' } }, serverFetch(store))
    const rec: ReqRecord = {
      barId: 'the-cove', date: '2026-11-20', requestedBy: 'a', approvedBy: 'b', issuedBy: 'c', status: 'draft',
      rows: [{ itemCode: 'A1', qty: 3 }],
    }
    const item = { form: 'req' as const, barId: 'the-cove', date: '2026-11-20' }
    await client.push(item, buildPayload('req', rec))
    const loaded = await client.load('the-cove', '2026-11')
    expect(loaded.reqs[0]).toMatchObject({ requestedBy: 'a', approvedBy: 'b', issuedBy: 'c', status: 'draft', rows: rec.rows })
    await client.push(item, buildPayload('req', { ...rec, rows: [] }))
    expect((await client.load('the-cove', '2026-11')).reqs).toEqual([])
  })
})
