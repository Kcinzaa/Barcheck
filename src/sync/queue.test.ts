import { beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => {
  localStorage.clear()
  vi.resetModules()
})

const a = { form: 'report' as const, barId: 'the-cove', date: '2026-11-20' }
const b = { form: 'req' as const, barId: 'the-cove', date: '2026-11-20' }
const c = { form: 'report' as const, barId: 'mango', date: '2026-11-21' }

describe('queue', () => {
  it('dedupes by key keeping first position', async () => {
    const q = await import('./queue')
    q.enqueue(a)
    q.enqueue(b)
    q.enqueue({ ...a })
    expect(q.size()).toBe(2)
    expect(q.peek()).toEqual(a)
    expect(q.list()).toEqual([a, b])
  })

  it('persists across re-instantiation', async () => {
    const q1 = await import('./queue')
    q1.enqueue(a)
    q1.enqueue(c)
    vi.resetModules()
    const q2 = await import('./queue')
    expect(q2.list()).toEqual([a, c])
    q2.remove(a)
    vi.resetModules()
    const q3 = await import('./queue')
    expect(q3.list()).toEqual([c])
  })

  it('pendingKeys uses form:barId:date', async () => {
    const q = await import('./queue')
    q.enqueue(a)
    q.enqueue(b)
    expect(q.pendingKeys()).toEqual(new Set(['report:the-cove:2026-11-20', 'req:the-cove:2026-11-20']))
  })

  it('survives corrupt or malformed stored queue', async () => {
    localStorage.setItem('barcheck:sync:queue', '{nope')
    let q = await import('./queue')
    expect(q.size()).toBe(0)
    vi.resetModules()
    localStorage.setItem('barcheck:sync:queue', JSON.stringify([a, { form: 'x' }, 5, null]))
    q = await import('./queue')
    expect(q.list()).toEqual([a])
  })
})

describe('config', () => {
  it('round-trips and clears', async () => {
    const cfg = await import('./config')
    expect(cfg.getConfig()).toBeNull()
    cfg.setConfig({ url: 'https://x', keys: { mango: 'k' } })
    expect(cfg.getConfig()).toEqual({ url: 'https://x', keys: { mango: 'k' } })
    expect(localStorage.getItem('barcheck:sync:config')).toContain('https://x')
    cfg.setConfig(null)
    expect(cfg.getConfig()).toBeNull()
  })

  it('corrupt or wrong-shaped config reads as null', async () => {
    const cfg = await import('./config')
    for (const raw of ['{bad', '5', '{"url":1,"keys":{}}', '{"url":"u","keys":{"a":1}}', '{"url":"u"}', '[]']) {
      localStorage.setItem('barcheck:sync:config', raw)
      expect(cfg.getConfig()).toBeNull()
    }
  })

  it('notifies listeners on change', async () => {
    const cfg = await import('./config')
    const cb = vi.fn()
    const off = cfg.onConfigChange(cb)
    cfg.setConfig({ url: 'u', keys: {} })
    expect(cb).toHaveBeenCalledTimes(1)
    off()
    cfg.setConfig(null)
    expect(cb).toHaveBeenCalledTimes(1)
  })
})
