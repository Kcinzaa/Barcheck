import { useCallback, useEffect, useRef, useState } from 'react'

const AUTOSAVE_MS = 300
const CONFIRM_MS = 2500

/**
 * Debounced draft autosave. Nothing is written until `markDirty()` is called (so opening a
 * page never writes). Pending edits are flushed on unmount, pagehide and tab hide.
 * `snapshot` must change identity whenever the form state changes; `write` may close over
 * stale state, so callers should read current values from a ref.
 */
export function useAutosave(write: (status: 'draft' | 'saved') => void, snapshot: unknown) {
  const writeRef = useRef(write)
  writeRef.current = write
  const dirty = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [justSaved, setJustSaved] = useState(false)

  const clearTimer = () => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
  }

  const flush = useCallback(() => {
    clearTimer()
    if (!dirty.current) return
    dirty.current = false
    writeRef.current('draft')
  }, [])

  useEffect(() => {
    if (!dirty.current) return
    clearTimer()
    timer.current = setTimeout(flush, AUTOSAVE_MS)
  }, [snapshot, flush])

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onHide)
      flush()
    }
  }, [flush])

  useEffect(() => {
    if (!justSaved) return
    const t = setTimeout(() => setJustSaved(false), CONFIRM_MS)
    return () => clearTimeout(t)
  }, [justSaved])

  const markDirty = useCallback(() => {
    dirty.current = true
    setJustSaved(false)
  }, [])

  const saveNow = useCallback(() => {
    clearTimer()
    dirty.current = false
    writeRef.current('saved')
    setJustSaved(true)
  }, [])

  return { markDirty, saveNow, justSaved }
}
