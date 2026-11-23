import { memo, useEffect, useState } from 'react'
import QtyInput from './QtyInput'
import { calcRow } from '../domain/calc'
import { fromOz, toOz } from '../domain/units'
import type { BarReportRow, Item } from '../domain/types'

export type RowPatch = Partial<Omit<BarReportRow, 'itemCode'>>

interface Props {
  item: Item
  row: BarReportRow
  onChange(itemCode: string, patch: RowPatch): void
}

const fmtBtlOz = (oz: number, sizeOz: number) => {
  const { bottles, oz: rest } = fromOz(oz, sizeOz)
  return `${bottles} ขวด ${rest} oz`
}

const fmtSigned = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0')

/** Bottles + oz entry for a quantity stored as total oz. */
function BtlOzInput({
  label,
  valueOz,
  sizeOz,
  onChange,
}: {
  label: string
  valueOz: number
  sizeOz: number
  onChange(oz: number): void
}) {
  const [parts, setParts] = useState(() => fromOz(valueOz, sizeOz))

  // Keep the split the user typed (e.g. "0 btl 30 oz") unless the stored total changes from outside.
  useEffect(() => {
    setParts((p) => (toOz(p.bottles, p.oz, sizeOz) === valueOz ? p : fromOz(valueOz, sizeOz)))
  }, [valueOz, sizeOz])

  const set = (bottles: number, oz: number) => {
    setParts({ bottles, oz })
    onChange(toOz(bottles, oz, sizeOz))
  }

  return (
    <fieldset className="ic-field">
      <legend>{label}</legend>
      <div className="ic-pair">
        <QtyInput label={`${label} ขวด`} unit="ขวด" value={parts.bottles} onChange={(b) => set(b, parts.oz)} />
        <QtyInput label={`${label} oz`} unit="oz" value={parts.oz} onChange={(o) => set(parts.bottles, o)} />
      </div>
    </fieldset>
  )
}

function ItemCard({ item, row, onChange }: Props) {
  const size = item.sizeOz ?? 0
  const code = item.code
  const { closed, variance, negative } = calcRow(row, size)
  const set = (patch: RowPatch) => onChange(code, patch)
  const counted = row.countedBtl !== undefined || row.countedOz !== undefined
  const [moreOpen, setMoreOpen] = useState(
    () => row.dailyStore !== 0 || row.transferIn !== 0 || row.transferOut !== 0 || counted || row.remark !== '',
  )

  return (
    <article className="item-card" data-testid={`item-${code}`} aria-labelledby={`name-${code}`}>
      <header className="ic-head">
        <h3 id={`name-${code}`} className="ic-name">
          {item.name}
        </h3>
        <span className="ic-size">{size} oz/ขวด</span>
      </header>

      <fieldset className="ic-field">
        <legend>Open</legend>
        <div className="ic-pair">
          <QtyInput label="Open ขวด" unit="ขวด" value={row.openBtl} onChange={(n) => set({ openBtl: n })} />
          <QtyInput label="Open oz" unit="oz" value={row.openOz} onChange={(n) => set({ openOz: n })} />
        </div>
      </fieldset>

      <fieldset className="ic-field">
        <legend>Sale</legend>
        <div className="ic-pair">
          <QtyInput label="Sale oz" unit="oz" value={row.sale} onChange={(n) => set({ sale: n })} />
        </div>
      </fieldset>

      <div className={negative ? 'ic-closed is-negative' : 'ic-closed'}>
        <span>Closed</span>
        <strong data-testid={`closed-${code}`} className={negative ? 'negative' : undefined}>
          {fmtBtlOz(closed, size)}
        </strong>
      </div>
      {negative && (
        <p className="ic-warn ic-warn-negative" role="alert" data-testid="negative-warning">
          ยอดขายเกินสต็อก — ตรวจสอบตัวเลข
        </p>
      )}
      {variance !== null && variance !== 0 && (
        <p className="ic-warn ic-warn-variance" role="alert" data-testid="variance">
          ส่วนต่าง {fmtSigned(variance)} oz (นับจริง − คำนวณ)
        </p>
      )}
      <button
        type="button"
        className="ic-more-toggle"
        aria-expanded={moreOpen}
        onClick={() => setMoreOpen((o) => !o)}
      >
        เพิ่มเติม: Store / Transfer / นับจริง / Remark
      </button>
      {/* Rendered only when expanded: keeps ~219 cards light on phones. */}
      {moreOpen && (
        <div className="ic-more">
          <BtlOzInput label="Daily Store" valueOz={row.dailyStore} sizeOz={size} onChange={(n) => set({ dailyStore: n })} />
          <BtlOzInput label="Transfer In" valueOz={row.transferIn} sizeOz={size} onChange={(n) => set({ transferIn: n })} />
          <BtlOzInput label="Transfer Out" valueOz={row.transferOut} sizeOz={size} onChange={(n) => set({ transferOut: n })} />

          <fieldset className="ic-field">
            <legend>นับจริง (ไม่บังคับ)</legend>
            <div className="ic-pair">
              <QtyInput
                label="นับจริง ขวด"
                unit="ขวด"
                value={row.countedBtl ?? 0}
                onChange={(n) => set({ countedBtl: n })}
              />
              <QtyInput
                label="นับจริง oz"
                unit="oz"
                value={row.countedOz ?? 0}
                onChange={(n) => set({ countedOz: n })}
              />
            </div>
            {counted && (
              <button
                type="button"
                className="ic-clear"
                onClick={() => set({ countedBtl: undefined, countedOz: undefined })}
              >
                ล้างค่านับ
              </button>
            )}
          </fieldset>

          <label className="ic-field ic-remark">
            <span>Remark</span>
            <input type="text" aria-label="Remark" value={row.remark} onChange={(e) => set({ remark: e.target.value })} />
          </label>
        </div>
      )}
    </article>
  )
}

export default memo(ItemCard)
