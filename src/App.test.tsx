import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import App from './App'

describe('App routes', () => {
  it('renders Home at / and Monthly at /monthly', () => {
    const { unmount } = render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    )
    expect(screen.getByRole('heading', { name: 'Barcheck' })).toBeTruthy()
    unmount()

    render(
      <MemoryRouter initialEntries={['/monthly']}>
        <App />
      </MemoryRouter>,
    )
    expect(screen.getByRole('heading', { name: 'สรุปรายเดือน' })).toBeTruthy()
  })

  it('renders report and requisition placeholders with params', () => {
    const { unmount } = render(
      <MemoryRouter initialEntries={['/bar/b1/2026-11-23/report']}>
        <App />
      </MemoryRouter>,
    )
    expect(screen.getByTestId('bar-report')).toBeTruthy()
    unmount()
    render(
      <MemoryRouter initialEntries={['/bar/b1/2026-11-23/requisition']}>
        <App />
      </MemoryRouter>,
    )
    expect(screen.getByTestId('requisition')).toBeTruthy()
  })
})
