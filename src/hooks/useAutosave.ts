import { useCallback, useEffect, useRef, useState } from 'react'

export const SAVE_ERROR = 'บันทึกไม่สำเร็จ — พื้นที่เก็บข้อมูลเต็มหรือถูกปิดไว้ ให้ถ่ายภาพหน้าจอหรือส่งออกข้อมูลไว้ก่อน'

const AUTOSAVE_MS = 300
const CONFIRM_MS = 2500

/**
 * Debounced draft autosave. Nothing is written until `markDirty()` is called (so opening a
 * page never writes). Pending edits are flushed on unmount, pagehide and tab hide.
 * A failed write (returns false) keeps the form dirty so the next edit, explicit save or
 * flush retries it, and sets `saveFailed` (cleared by the next edit or successful write).
 * `snapshot` must change identity whenever the form state changes; `write` may close over
 * stale state, so callers should read current values from a ref.
 */
export function useAutosave(write: (status: 'draft' | 'saved') => boolean, snapshot: unknown) {
  const writeRef = useRef(write)
  writeRef.current = write
  const dirty = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [justSaved, setJustSaved] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)

  const clearTimer = () => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
  }

  const flush = useCallback(() => {
    clearTimer()
    if (!dirty.current) return
    dirty.current = false
    const ok = writeRef.current('draft')
    if (!ok) dirty.current = true
    setSaveFailed(!ok)
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
    setSaveFailed(false)
  }, [])

  const saveNow = useCallback(() => {
    clearTimer()
    const ok = writeRef.current('saved')
    dirty.current = !ok
    setJustSaved(ok)
    setSaveFailed(!ok)
  }, [])

  return { markDirty, saveNow, justSaved, saveFailed }
}
