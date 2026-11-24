import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import QtyInput from './QtyInput'

function Harness({ initial = 0, onValue }: { initial?: number; onValue?: (n: number) => void }) {
  const [v, setV] = useState(initial)
  return (
    <QtyInput
      label="Qty"
      value={v}
      onChange={(n) => {
        setV(n)
        onValue?.(n)
      }}
    />
  )
}

const input = () => screen.getByLabelText('Qty') as HTMLInputElement

describe('QtyInput', () => {
  it('keeps partially typed comma decimals while emitting the number', () => {
    const seen: number[] = []
    render(<Harness onValue={(n) => seen.push(n)} />)
    fireEvent.change(input(), { target: { value: '7,' } })
    expect(input().value).toBe('7,')
    fireEvent.change(input(), { target: { value: '7,5' } })
    expect(input().value).toBe('7,5')
    expect(seen).toEqual([7, 7.5])
  })

  it('blank emits 0 and shows empty with placeholder', () => {
    const seen: number[] = []
    render(<Harness initial={3} onValue={(n) => seen.push(n)} />)
    expect(input().value).toBe('3')
    fireEvent.change(input(), { target: { value: '' } })
    expect(seen).toEqual([0])
    expect(input().value).toBe('')
    expect(input().placeholder).toBe('0')
  })

  it('steppers add/subtract 1, clamp at 0 and keep one decimal', () => {
    render(<Harness initial={0.5} />)
    fireEvent.click(screen.getByRole('button', { name: 'เพิ่ม Qty' }))
    expect(input().value).toBe('1.5')
    fireEvent.click(screen.getByRole('button', { name: 'ลด Qty' }))
    fireEvent.click(screen.getByRole('button', { name: 'ลด Qty' }))
    expect(input().value).toBe('')
  })

  it('clamps typed negatives to 0 and does not show them', () => {
    const seen: number[] = []
    render(<Harness onValue={(n) => seen.push(n)} />)
    fireEvent.change(input(), { target: { value: '-5' } })
    expect(seen).toEqual([0])
    expect(input().value).not.toContain('-')
    fireEvent.change(input(), { target: { value: '7,5' } })
    expect(seen[seen.length - 1]).toBe(7.5)
    expect(input().value).toBe('7,5')
  })

  it('calls onBlank instead of onChange when the text becomes empty', () => {
    const onChange = vi.fn()
    const onBlank = vi.fn()
    render(<QtyInput label="Qty" value={3} onChange={onChange} onBlank={onBlank} />)
    fireEvent.change(input(), { target: { value: '  ' } })
    expect(onBlank).toHaveBeenCalledTimes(1)
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.change(input(), { target: { value: '0' } })
    expect(onChange).toHaveBeenCalledWith(0)
  })
})
