import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReportRecord, ReqRecord } from '../storage/repo'

const BAR = 'the-cove'
const row = (over: Record<string, unknown> = {}) => ({
  itemCode: 'A1', openBtl: 1, openOz: 0, dailyStore: 0, transferIn: 0, transferOut: 0, sale: 1, remark: '', ...over,
})
const report = (date: string, sale = 1, barId = BAR): ReportRecord => ({
  barId, date, reportBy: 'amy', status: 'saved', rows: [row({ sale })],
})
const reqRec = (date: string): ReqRecord => ({
  barId: BAR, date, requestedBy: 'a', approvedBy: 'b', issuedBy: 'c', status: 'saved', rows: [{ itemCode: 'A1', qty: 2 }],
})
const reply = (o: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify(o) }) as unknown as Response

type Mods = {
  repo: typeof import('../storage/repo').repo
  queue: typeof import('./queue')
  config: typeof import('./config')
  engine: typeof import('./engine')
}
async function load(): Promise<Mods> {
  vi.resetModules()
  const repo = (await import('../storage/repo')).repo
  const queue = await import('./queue')
  const config = await import('./config')
  const engine = await import('./engine')
  return { repo, queue, config, engine }
}
const flushAsync = () => vi.advanceTimersByTimeAsync(0)

let fetchMock: ReturnType<typeof vi.fn>
const bodies = () =>
  fetchMock.mock.calls.map((c) => JSON.parse((c as unknown as [string, RequestInit])[1].body as string) as Record<string, unknown>)

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers()
  fetchMock = vi.fn(async () => reply({ ok: true }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function configured(m: Mods) {
  m.config.setConfig({ url: 'https://example.test/SECRETURL', keys: { [BAR]: 'SECRETKEY', mango: 'MK' } })
}

describe('engine flushing', () => {
  it('offline save: state offline, pending 1, local data intact; online flush sends in order with LATEST record', async () => {
    const m = await load()
    configured(m)
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const stop = m.engine.startSync()
    m.repo.saveReport(report('2026-11-20', 1))
    m.repo.saveReq(reqRec('2026-11-20'))
    await flushAsync()
    expect(m.engine.getState()).toMatchObject({ status: 'offline', pending: 2 })
    expect(fetchMock).toHaveBeenCalledTimes(1) // stops at first failure, keeps order
    expect(m.repo.getReport(BAR, '2026-11-20')?.rows[0].sale).toBe(1)

    m.repo.saveReport(report('2026-11-20', 9)) // edit after enqueue
    fetchMock.mockReset()
    fetchMock.mockImplementation(async () => reply({ ok: true }))
    window.dispatchEvent(new Event('online'))
    await flushAsync()
    const sent = bodies()
    expect(sent.map((b) => b.form)).toEqual(['report', 'req'])
    expect((sent[0].rows as { sale: number }[])[0].sale).toBe(9)
    expect(m.engine.getState()).toMatchObject({ status: 'idle', pending: 0 })
    expect(m.engine.getState().lastSyncedAt).toBeTruthy()
    stop()
  })

  it('duplicate saves of the same key send once', async () => {
    const m = await load()
    configured(m)
    const stop = m.engine.startSync()
    m.repo.saveReport(report('2026-11-20', 1))
    m.repo.saveReport(report('2026-11-20', 2))
    m.repo.saveReport(report('2026-11-20', 3))
    await flushAsync()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect((bodies()[0].rows as { sale: number }[])[0].sale).toBe(3)
    stop()
  })

  it('edit during an in-flight push stays queued and is sent next', async () => {
    const m = await load()
    configured(m)
    const resolvers: ((r: Response) => void)[] = []
    fetchMock.mockImplementation(() => new Promise<Response>((res) => resolvers.push(res)))
    const stop = m.engine.startSync()
    m.repo.saveReport(report('2026-11-20', 1))
    await flushAsync()
    expect(resolvers).toHaveLength(1)
    expect(m.engine.getState().status).toBe('syncing')
    m.repo.saveReport(report('2026-11-20', 7)) // while in flight
    await flushAsync()
    expect(fetchMock).toHaveBeenCalledTimes(1) // still one in flight
    resolvers[0](reply({ ok: true }))
    await flushAsync()
    expect(m.engine.getState().pending).toBe(1)
    expect(resolvers).toHaveLength(2)
    expect((bodies()[1].rows as { sale: number }[])[0].sale).toBe(7)
    resolvers[1](reply({ ok: true }))
    await flushAsync()
    expect(m.engine.getState()).toMatchObject({ status: 'idle', pending: 0 })
    stop()
  })

  it('payload shape: report meta has status, reportBy, items; req meta has signers', async () => {
    const m = await load()
    configured(m)
    const stop = m.engine.startSync()
    m.repo.saveReport({ ...report('2026-11-20'), rows: [row({ itemCode: 'ZZ-UNKNOWN' })] })
    m.repo.saveReq(reqRec('2026-11-20'))
    await flushAsync()
    const [r, q] = bodies()
    expect(r).toMatchObject({ action: 'push', barId: BAR, key: 'SECRETKEY', form: 'report', date: '2026-11-20' })
    expect(r.meta).toMatchObject({ status: 'saved', reportBy: 'amy' })
    expect(q.meta).toMatchObject({ status: 'saved', requestedBy: 'a', approvedBy: 'b', issuedBy: 'c' })
    expect(q.rows).toEqual([{ itemCode: 'A1', qty: 2 }])
    stop()
  })

  it('record with 0 rows is pushed as rows: []', async () => {
    const m = await load()
    configured(m)
    const stop = m.engine.startSync()
    m.repo.saveReport({ ...report('2026-11-20'), rows: [] })
    await flushAsync()
    expect(bodies()[0].rows).toEqual([])
    stop()
  })

  it('drops a queue item whose local record no longer exists', async () => {
    const m = await load()
    configured(m)
    m.queue.enqueue({ form: 'report', barId: BAR, date: '2026-11-20' })
    const stop = m.engine.startSync()
    await flushAsync()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(m.engine.getState()).toMatchObject({ status: 'idle', pending: 0 })
    stop()
  })

  it('flushes a persisted queue on start', async () => {
    const m = await load()
    configured(m)
    m.repo.saveReport(report('2026-11-20'))
    m.queue.enqueue({ form: 'report', barId: BAR, date: '2026-11-20' })
    const stop = m.engine.startSync()
    await flushAsync()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    stop()
  })

  it('flushes on visibilitychange when visible', async () => {
    const m = await load()
    configured(m)
    fetchMock.mockRejectedValueOnce(new TypeError('x'))
    const stop = m.engine.startSync()
    m.repo.saveReport(report('2026-11-20'))
    await flushAsync()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    document.dispatchEvent(new Event('visibilitychange'))
    await flushAsync()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(m.engine.getState().pending).toBe(0)
    stop()
  })
})

describe('engine errors', () => {
  it('unauthorized: error state, queue kept, NO retry timer, saving still works, new save re-triggers', async () => {
    const m = await load()
    configured(m)
    fetchMock.mockResolvedValue(reply({ ok: false, error: 'unauthorized' }))
    const stop = m.engine.startSync()
    expect(m.repo.saveReport(report('2026-11-20'))).toBe(true)
    await flushAsync()
    expect(m.engine.getState()).toMatchObject({ status: 'error', error: 'unauthorized', pending: 1 })
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(120000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(m.repo.saveReport(report('2026-11-21'))).toBe(true)
    await flushAsync()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(m.engine.getState().pending).toBe(2)
    expect(m.repo.getReport(BAR, '2026-11-20')).not.toBeNull()
    fetchMock.mockResolvedValue(reply({ ok: true }))
    await m.engine.retryNow()
    expect(m.engine.getState()).toMatchObject({ status: 'idle', pending: 0 })
    stop()
  })

  it('bad_request does not auto retry either', async () => {
    const m = await load()
    configured(m)
    fetchMock.mockResolvedValue(reply({ ok: false, error: 'bad_request' }))
    const stop = m.engine.startSync()
    m.repo.saveReport(report('2026-11-20'))
    await flushAsync()
    expect(m.engine.getState()).toMatchObject({ status: 'error', error: 'bad_request' })
    expect(vi.getTimerCount()).toBe(0)
    stop()
  })

  it('HTML response -> bad_response, not synced, retried with backoff', async () => {
    const m = await load()
    configured(m)
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => '<html>oops</html>' } as unknown as Response)
    const stop = m.engine.startSync()
    m.repo.saveReport(report('2026-11-20'))
    await flushAsync()
    expect(m.engine.getState()).toMatchObject({ status: 'error', error: 'bad_response', pending: 1 })
    expect(m.engine.getState().lastSyncedAt).toBeUndefined()
    expect(vi.getTimerCount()).toBe(1)
    stop()
  })

  it('timeout -> error timeout', async () => {
    const m = await load()
    configured(m)
    fetchMock.mockImplementation(
      (_u: string, init?: RequestInit) =>
        new Promise<Response>((_r, rej) => {
          init?.signal?.addEventListener('abort', () => rej(new DOMException('a', 'AbortError')))
        }),
    )
    const stop = m.engine.startSync()
    m.repo.saveReport(report('2026-11-20'))
    await vi.advanceTimersByTimeAsync(15000)
    expect(m.engine.getState()).toMatchObject({ status: 'error', error: 'timeout', pending: 1 })
    stop()
  })

  it('backoff doubles 5,10,20,40,60 and caps; success resets', async () => {
    const m = await load()
    configured(m)
    fetchMock.mockRejectedValue(new TypeError('offline'))
    const stop = m.engine.startSync()
    m.repo.saveReport(report('2026-11-20'))
    await flushAsync()
    let calls = 1
    expect(fetchMock).toHaveBeenCalledTimes(calls)
    for (const d of [5000, 10000, 20000, 40000, 60000, 60000]) {
      await vi.advanceTimersByTimeAsync(d - 1)
      expect(fetchMock).toHaveBeenCalledTimes(calls)
      await vi.advanceTimersByTimeAsync(1)
      calls++
      expect(fetchMock).toHaveBeenCalledTimes(calls)
    }
    fetchMock.mockResolvedValue(reply({ ok: true }))
    await vi.advanceTimersByTimeAsync(60000)
    expect(m.engine.getState()).toMatchObject({ status: 'idle', pending: 0 })
    // reset: next failure retries after 5 s again
    fetchMock.mockRejectedValue(new TypeError('offline'))
    m.repo.saveReport(report('2026-11-22'))
    await flushAsync()
    const n = fetchMock.mock.calls.length
    await vi.advanceTimersByTimeAsync(5000)
    expect(fetchMock).toHaveBeenCalledTimes(n + 1)
    stop()
  })

  it('retryNow flushes immediately and resets backoff', async () => {
    const m = await load()
    configured(m)
    fetchMock.mockRejectedValue(new TypeError('offline'))
    const stop = m.engine.startSync()
    m.repo.saveReport(report('2026-11-20'))
    await flushAsync()
    await vi.advanceTimersByTimeAsync(5000) // second failure -> next delay 10 s
    const n = fetchMock.mock.calls.length
    await m.engine.retryNow()
    expect(fetchMock).toHaveBeenCalledTimes(n + 1)
    await vi.advanceTimersByTimeAsync(5000) // reset, so 5 s
    expect(fetchMock).toHaveBeenCalledTimes(n + 2)
    stop()
  })

  it('missing key: error missing_key, no fetch, queue kept, other items still sent', async () => {
    const m = await load()
    m.config.setConfig({ url: 'https://example.test/x', keys: { mango: 'MK' } })
    const stop = m.engine.startSync()
    m.repo.saveReport(report('2026-11-20')) // the-cove: no key
    m.repo.saveReport(report('2026-11-20', 1, 'mango'))
    await flushAsync()
    expect(bodies().map((b) => b.barId)).toEqual(['mango'])
    expect(m.engine.getState()).toMatchObject({ status: 'error', error: 'missing_key', pending: 1 })
    expect(vi.getTimerCount()).toBe(0)
    stop()
  })

  it('unconfigured: zero fetch calls, state unconfigured, pending tracked', async () => {
    const m = await load()
    const stop = m.engine.startSync()
    expect(m.engine.getState().status).toBe('unconfigured')
    m.repo.saveReport(report('2026-11-20'))
    await flushAsync()
    await m.engine.retryNow()
    await m.engine.pull(BAR, '2026-11')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(m.engine.getState()).toMatchObject({ status: 'unconfigured', pending: 1 })
    m.config.setConfig({ url: 'https://example.test/x', keys: { [BAR]: 'k' } }) // config change re-triggers
    await flushAsync()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(m.engine.getState()).toMatchObject({ status: 'idle', pending: 0 })
    stop()
  })

  it('no url or key leaks into state or listener payloads', async () => {
    const m = await load()
    configured(m)
    const seen: string[] = []
    m.engine.subscribe((s) => seen.push(JSON.stringify(s)))
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch https://example.test/SECRETURL'))
    const stop = m.engine.startSync()
    m.repo.saveReport(report('2026-11-20'))
    await flushAsync()
    const all = seen.join('|') + JSON.stringify(m.engine.getState())
    expect(all).not.toContain('SECRETURL')
    expect(all).not.toContain('SECRETKEY')
    stop()
  })
})

describe('engine lifecycle', () => {
  it('startSync is idempotent; unsubscribe stops reacting', async () => {
    const m = await load()
    configured(m)
    const stop1 = m.engine.startSync()
    const stop2 = m.engine.startSync()
    m.repo.saveReport(report('2026-11-20'))
    await flushAsync()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    stop1()
    stop2()
    m.repo.saveReport(report('2026-11-21'))
    window.dispatchEvent(new Event('online'))
    await flushAsync()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('unsubscribe clears pending retry timers', async () => {
    const m = await load()
    configured(m)
    fetchMock.mockRejectedValue(new TypeError('x'))
    const stop = m.engine.startSync()
    m.repo.saveReport(report('2026-11-20'))
    await flushAsync()
    expect(vi.getTimerCount()).toBe(1)
    stop()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('subscribe notifies on change, not on subscribe, and a throwing listener is harmless', async () => {
    const m = await load()
    configured(m)
    const cb = vi.fn()
    const off = m.engine.subscribe(cb)
    expect(cb).not.toHaveBeenCalled()
    m.engine.subscribe(() => {
      throw new Error('bad listener')
    })
    const stop = m.engine.startSync()
    m.repo.saveReport(report('2026-11-20'))
    await flushAsync()
    expect(cb).toHaveBeenCalled()
    const n = cb.mock.calls.length
    off()
    m.repo.saveReport(report('2026-11-21'))
    await flushAsync()
    expect(cb.mock.calls.length).toBe(n)
    stop()
  })
})

describe('pull', () => {
  const remoteReport = (date: string, over: Partial<ReportRecord> = {}): ReportRecord => ({
    barId: BAR, date, reportBy: 'remote', status: 'saved', rows: [row({ sale: 5 })], updatedAt: '2026-11-24T10:00:00.000Z', ...over,
  })

  it('merges remote but skips keys in pendingKeys, without echoing to the queue', async () => {
    const m = await load()
    configured(m)
    fetchMock.mockResolvedValue(
      reply({ ok: true, reports: [remoteReport('2026-11-20'), remoteReport('2026-11-21')], reqs: [{ ...reqRec('2026-11-20'), requestedBy: 'remote' }] }),
    )
    m.queue.enqueue({ form: 'report', barId: BAR, date: '2026-11-20' })
    m.repo.saveReport(report('2026-11-20', 1)) // local pending edit (no engine started -> not queued by listener)
    m.queue.list() // pending stays
    await m.engine.pull(BAR, '2026-11')
    expect(m.repo.getReport(BAR, '2026-11-20')?.reportBy).toBe('amy') // pending protected
    expect(m.repo.getReport(BAR, '2026-11-21')?.reportBy).toBe('remote')
    expect(m.repo.getReq(BAR, '2026-11-20')?.requestedBy).toBe('remote')
    expect(m.queue.size()).toBe(1) // no echo
    expect(m.engine.getState().pending).toBe(1)
  })

  it('skips other-bar and malformed records; absence never deletes', async () => {
    const m = await load()
    configured(m)
    m.repo.saveReport(report('2026-11-05')) // local only, not in remote response
    fetchMock.mockResolvedValue(
      reply({
        ok: true,
        reports: [
          remoteReport('2026-11-20', { barId: 'mango' }),
          { barId: BAR, date: '2026-11-21', status: 'weird', rows: [] },
          { barId: BAR, date: 'nope', status: 'saved', rows: [] },
          null,
          'x',
          remoteReport('2026-11-22'),
        ],
        reqs: [],
      }),
    )
    await m.engine.pull(BAR, '2026-11')
    expect(m.repo.getReport('mango', '2026-11-20')).toBeNull()
    expect(m.repo.getReport(BAR, '2026-11-20')).toBeNull()
    expect(m.repo.getReport(BAR, '2026-11-21')).toBeNull()
    expect(m.repo.getReport(BAR, '2026-11-22')?.reportBy).toBe('remote')
    expect(m.repo.getReport(BAR, '2026-11-05')).not.toBeNull()
  })

  it('never throws; errors go to state and keep pending accurate', async () => {
    const m = await load()
    configured(m)
    m.queue.enqueue({ form: 'report', barId: BAR, date: '2026-11-20' })
    fetchMock.mockResolvedValue(reply({ ok: false, error: 'unauthorized' }))
    await expect(m.engine.pull(BAR, '2026-11')).resolves.toBeUndefined()
    expect(m.engine.getState()).toMatchObject({ status: 'error', error: 'unauthorized', pending: 1 })
    fetchMock.mockRejectedValue(new TypeError('x'))
    await m.engine.pull(BAR, '2026-11')
    expect(m.engine.getState()).toMatchObject({ status: 'offline', pending: 1 })
  })

  it('missing key for the bar sets state and does not fetch', async () => {
    const m = await load()
    m.config.setConfig({ url: 'https://example.test/x', keys: {} })
    await m.engine.pull(BAR, '2026-11')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(m.engine.getState()).toMatchObject({ status: 'error', error: 'missing_key' })
  })

  it('does not use saveReport/saveReq', async () => {
    const m = await load()
    configured(m)
    const spy = vi.spyOn(m.repo, 'saveReport')
    fetchMock.mockResolvedValue(reply({ ok: true, reports: [remoteReport('2026-11-20')], reqs: [] }))
    await m.engine.pull(BAR, '2026-11')
    expect(spy).not.toHaveBeenCalled()
    expect(m.repo.getReport(BAR, '2026-11-20')).not.toBeNull()
  })
})
