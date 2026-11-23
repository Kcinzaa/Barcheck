import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import Requisition from './Requisition'
import { ITEMS } from '../data/items'
import { repo } from '../storage/repo'

const REQ_ITEMS = ITEMS.filter((i) => i.form === 'requisition')
const BAR = 'the-cove'
const DATE = '2026-11-23'
const campari = REQ_ITEMS.find((i) => i.name === 'Campari')!
const other = REQ_ITEMS.find((i) => i.category === 'Food')!

function renderPage(barId = BAR, date = DATE) {
  return render(
    <MemoryRouter initialEntries={[`/bar/${barId}/${date}/requisition`]}>
      <Routes>
        <Route path="/bar/:barId/:date/requisition" element={<Requisition />} />
      </Routes>
    </MemoryRouter>,
  )
}

const search = (q: string) =>
  fireEvent.change(screen.getByLabelText('ค้นหาสินค้า'), { target: { value: q } })
const qtyInput = (code: string) =>
  within(screen.getByTestId(`req-${code}`)).getByRole('textbox') as HTMLInputElement
const typeQty = (code: string, v: string) => fireEvent.change(qtyInput(code), { target: { value: v } })
const counter = () => screen.getByTestId('counter').textContent
const by = (label: string) => screen.getByLabelText(label) as HTMLInputElement

describe('Requisition', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('groups items by category', () => {
    renderPage()
    for (const c of ['Beverage', 'Food', 'General', 'Wine', 'Frozen', 'Monin', 'Fruit Juice']) {
      expect(screen.getByRole('button', { name: new RegExp(`^${c} \\(\\d+\\)`) })).toBeTruthy()
    }
    expect(screen.getByTestId(`req-${campari.code}`).textContent).toContain(campari.code)
    expect(screen.getByTestId(`req-${campari.code}`).textContent).toContain('Campari')
  })

  it('saves qty 3 as saved and omits zero rows', () => {
    renderPage()
    search('Campari')
    typeQty(campari.code, '3')
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }))
    const rec = repo.getReq(BAR, DATE)!
    expect(rec.status).toBe('saved')
    expect(rec.rows).toEqual([{ itemCode: campari.code, qty: 3 }])
    expect(screen.getByRole('status').textContent).toContain('บันทึกแล้ว')
    expect(counter()).toContain('1')
  })

  it('persists requestedBy / approvedBy / issuedBy', () => {
    renderPage()
    fireEvent.change(by('ผู้ขอเบิก'), { target: { value: 'A' } })
    fireEvent.change(by('ผู้อนุมัติ'), { target: { value: 'B' } })
    fireEvent.change(by('ผู้จ่าย'), { target: { value: 'C' } })
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }))
    const rec = repo.getReq(BAR, DATE)!
    expect([rec.requestedBy, rec.approvedBy, rec.issuedBy]).toEqual(['A', 'B', 'C'])
  })

  it('search filters items', () => {
    renderPage()
    search('campari')
    expect(screen.queryByTestId(`req-${campari.code}`)).not.toBeNull()
    expect(screen.queryByTestId(`req-${other.code}`)).toBeNull()
    search('zzzzqqq')
    expect(screen.getByText(/ไม่พบสินค้า/)).toBeTruthy()
  })

  it('autosaves a draft and restores after remount', () => {
    vi.useFakeTimers()
    const { unmount } = renderPage()
    search('Campari')
    typeQty(campari.code, '2,5')
    expect(repo.getReq(BAR, DATE)).toBeNull()
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(repo.getReq(BAR, DATE)!.status).toBe('draft')
    unmount()
    renderPage()
    search('Campari')
    expect(qtyInput(campari.code).value).toBe('2.5')
    expect(repo.getReq(BAR, DATE)!.status).toBe('draft')
  })

  it('flushes pending edit on unmount', () => {
    vi.useFakeTimers()
    const { unmount } = renderPage()
    fireEvent.change(by('ผู้ขอเบิก'), { target: { value: 'Z' } })
    unmount()
    expect(repo.getReq(BAR, DATE)!.requestedBy).toBe('Z')
  })

  it('opening a saved record without editing does not write', () => {
    repo.saveReq({ barId: BAR, date: DATE, requestedBy: 'x', approvedBy: '', issuedBy: '', status: 'saved', rows: [{ itemCode: campari.code, qty: 1 }] })
    vi.useFakeTimers()
    const spy = vi.spyOn(repo, 'saveReq')
    const { unmount } = renderPage()
    expect(counter()).toContain('1')
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    unmount()
    expect(spy).not.toHaveBeenCalled()
    expect(repo.getReq(BAR, DATE)!.status).toBe('saved')
  })

  it('editing a saved record turns it into a draft', () => {
    repo.saveReq({ barId: BAR, date: DATE, requestedBy: '', approvedBy: '', issuedBy: '', status: 'saved', rows: [] })
    vi.useFakeTimers()
    renderPage()
    search('Campari')
    typeQty(campari.code, '1')
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(repo.getReq(BAR, DATE)!.status).toBe('draft')
  })

  it('keeps unknown stored item codes on write', () => {
    repo.saveReq({ barId: BAR, date: DATE, requestedBy: '', approvedBy: '', issuedBy: '', status: 'saved', rows: [{ itemCode: 'GONE', qty: 4 }] })
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }))
    expect(repo.getReq(BAR, DATE)!.rows).toEqual([{ itemCode: 'GONE', qty: 4 }])
  })

  it('blank qty stores nothing and never NaN; negative clamps to 0', () => {
    renderPage()
    search('Campari')
    typeQty(campari.code, '5')
    typeQty(campari.code, '')
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }))
    expect(repo.getReq(BAR, DATE)!.rows).toEqual([])
    typeQty(campari.code, '-4')
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }))
    expect(repo.getReq(BAR, DATE)!.rows).toEqual([])
    expect(localStorage.getItem(`barcheck:req:${BAR}:${DATE}`)).not.toContain('NaN')
  })

  it('shows friendly message for unknown bar and invalid date, without writing', () => {
    const spy = vi.spyOn(repo, 'saveReq')
    const a = renderPage('nope')
    expect(screen.getByText(/ไม่พบบาร์/)).toBeTruthy()
    expect(screen.getByRole('link', { name: '← หน้าหลัก' })).toBeTruthy()
    a.unmount()
    renderPage(BAR, '2026-02-30')
    expect(screen.getByText(/วันที่ไม่ถูกต้อง/)).toBeTruthy()
    expect(spy).not.toHaveBeenCalled()
  })

  it('links back to home and to the bar report', () => {
    renderPage()
    expect(screen.getByRole('link', { name: '← หน้าหลัก' }).getAttribute('href')).toBe('/')
    expect(screen.getByRole('link', { name: /Bar Report/ }).getAttribute('href')).toBe(`/bar/${BAR}/${DATE}/report`)
  })
})
