import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient, SyncError } from './client'

const URL_ = 'https://script.google.com/macros/s/SECRETDEPLOY/exec'
const cfg = { url: URL_, keys: { 'the-cove': 'SECRETKEY' } }
const item = { form: 'report' as const, barId: 'the-cove', date: '2026-11-20' }
const payload = { rows: [], meta: { status: 'saved' as const } }

const resp = (body: string) => ({ ok: true, status: 200, text: async () => body }) as unknown as Response
const json = (o: unknown) => resp(JSON.stringify(o))

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    expect(e).toBeInstanceOf(SyncError)
    const err = e as SyncError
    expect(err.message).not.toContain('SECRETKEY')
    expect(err.message).not.toContain('SECRETDEPLOY')
    return err.code
  }
  return 'none'
}

describe('client wire protocol', () => {
  it('push posts text/plain JSON with redirect follow', async () => {
    const f = vi.fn(async () => json({ ok: true }))
    await createClient(cfg, f).push(item, { rows: [{ itemCode: 'A1', qty: 1 }], meta: { status: 'saved' } })
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(URL_)
    expect(init.method).toBe('POST')
    expect(init.redirect).toBe('follow')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('text/plain;charset=utf-8')
    expect(JSON.parse(init.body as string)).toEqual({
      action: 'push', barId: 'the-cove', key: 'SECRETKEY', form: 'report', date: '2026-11-20',
      rows: [{ itemCode: 'A1', qty: 1 }], meta: { status: 'saved' },
    })
  })

  it('load sends month and returns reports/reqs', async () => {
    const f = vi.fn(async () => json({ ok: true, reports: [{ a: 1 }], reqs: [] }))
    const r = await createClient(cfg, f).load('the-cove', '2026-11')
    expect(r.reports).toHaveLength(1)
    expect(JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({
      action: 'load', barId: 'the-cove', key: 'SECRETKEY', month: '2026-11',
    })
  })

  it('load rejects a response without arrays', async () => {
    const f = vi.fn(async () => json({ ok: true, reports: 5 }))
    expect(await codeOf(createClient(cfg, f).load('the-cove', '2026-11'))).toBe('bad_response')
  })

  it('items keeps well-formed rows only', async () => {
    const good = { code: 'A1', name: 'Gin', category: 'Spirits', form: 'bar', sizeOz: 25, active: true }
    const f = vi.fn(async () => json({ ok: true, items: [good, { code: 1 }, null, { ...good, form: 'zzz' }] }))
    expect(await createClient(cfg, f).items('the-cove')).toEqual([good])
  })

  it('maps server errors', async () => {
    for (const code of ['unauthorized', 'bad_request', 'server_error', 'busy']) {
      const f = vi.fn(async () => json({ ok: false, error: code }))
      expect(await codeOf(createClient(cfg, f).push(item, payload))).toBe(code)
    }
    const f = vi.fn(async () => json({ ok: false, error: 'wat' }))
    expect(await codeOf(createClient(cfg, f).push(item, payload))).toBe('bad_response')
  })

  it('HTML / non-JSON / non-object / missing ok -> bad_response', async () => {
    for (const body of ['<html>Error</html>', '', '[]', '"x"', '{"hello":1}', '{"ok":"yes"}']) {
      const f = vi.fn(async () => resp(body))
      expect(await codeOf(createClient(cfg, f).push(item, payload))).toBe('bad_response')
    }
  })

  it('thrown fetch -> network', async () => {
    const f = vi.fn(async () => {
      throw new TypeError('Failed to fetch ' + URL_)
    })
    expect(await codeOf(createClient(cfg, f).push(item, payload))).toBe('network')
  })

  it('times out after 15 s', async () => {
    const f = vi.fn(
      (_u: string, init?: RequestInit) =>
        new Promise<Response>((_res, rej) => {
          init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))
        }),
    )
    const p = codeOf(createClient(cfg, f as unknown as typeof fetch).push(item, payload))
    await vi.advanceTimersByTimeAsync(14999)
    let settled = false
    void p.then(() => (settled = true))
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await p).toBe('timeout')
  })

  it('missing key for bar -> unauthorized without fetching', async () => {
    const f = vi.fn()
    expect(await codeOf(createClient(cfg, f as unknown as typeof fetch).load('mango', '2026-11'))).toBe('unauthorized')
    expect(f).not.toHaveBeenCalled()
  })
})
