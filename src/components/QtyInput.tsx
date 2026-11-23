import { useEffect, useState } from 'react'
import { parseNum } from '../domain/units'

interface Props {
  value: number
  onChange(n: number): void
  label: string
  /** Short unit caption under the field, e.g. "ขวด" or "oz". */
  unit?: string
}

const show = (n: number) => (n === 0 ? '' : String(n))
const round1 = (n: number) => Math.round(n * 10) / 10

/** +/− stepper with a free-text decimal field. Blank or invalid text counts as 0. */
export default function QtyInput({ value, onChange, label, unit }: Props) {
  const [text, setText] = useState(() => show(value))

  // Resync when the value changes from outside (stepper, restore) but not while
  // the typed text already means the same number (e.g. "7," or "7.50").
  useEffect(() => {
    setText((t) => (parseNum(t) === value ? t : show(value)))
  }, [value])

  const step = (d: number) => onChange(Math.max(0, round1(value + d)))

  return (
    <div className="qty">
      <button type="button" className="qty-btn" aria-label={`ลด ${label}`} onClick={() => step(-1)}>
        −
      </button>
      <div className="qty-field">
        <input
          type="text"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0"
          aria-label={label}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            onChange(parseNum(e.target.value))
          }}
        />
        {unit && <span className="qty-unit" aria-hidden="true">{unit}</span>}
      </div>
      <button type="button" className="qty-btn" aria-label={`เพิ่ม ${label}`} onClick={() => step(1)}>
        +
      </button>
    </div>
  )
}
