# Barcheck

แอปกรอกสต็อกบาร์รายวัน (Bar Report + ใบเบิกสินค้า) สำหรับ Katathani Phuket Beach Resort — UI สองภาษา ไทย/อังกฤษ
Daily bar-stock entry app (Bar Report + Store Requisition) for Katathani Phuket Beach Resort. React 18 + TypeScript + Vite + Vitest.

## Run

```
npm i
npm run dev        # dev server
npm test           # = npx vitest run
npm run build      # tsc -b && vite build
```

## Where the data lives (read this)

Data is stored **only in each browser on each device** (`localStorage`, behind `repo` in `src/storage/repo.ts`).
There is **no sync** between staff phones. iOS Safari may evict site data of sites unused for about 7 days.
**Use the Monthly page's "Export Excel" regularly as the backup.**
If the browser refuses to write (private mode, full quota) the app shows a red error instead of "บันทึกแล้ว ✓".

## Status rules

Each Bar Report / Requisition is `draft` while being edited (autosaved after 300 ms, and on leaving the page) and `saved`
after pressing **บันทึก**. Editing a saved form turns it back into a draft until บันทึก is pressed again.

## Open auto-fill

Open is pre-filled from the latest *earlier* recorded Closed of the same item (a counted value, if present, wins over the
calculated Closed; a negative Closed is carried as 0). The pre-fill is display-only: nothing is written for the row until
the card is edited.

## IMPORTANT: item sizes (oz per bottle)

Bottle sizes live in `src/data/items.json`. About 93 bar items have no size on the paper form and **default to 23 oz**
(list: [`docs/item-sizes-to-verify.md`](docs/item-sizes-to-verify.md)). **Verify and correct them BEFORE the first real
entry.** Stock is stored as bottles + oz and converted with the *current* size, so changing a size after data exists
shifts historical stock by bottles x change.

To correct sizes safely, do not hand-edit `items.json`. Add entries to `SIZE_OVERRIDES` in `scripts/build-seed.py`
(key = item code such as `"B012"`, or normalised name) and regenerate:

```
python3 -I scripts/build-seed.py /path/to/BAR_Reports.xlsx   # xlsx path is required
```

Overrides are applied after PDF sizes/defaults, so they survive regeneration.

## Next step

Planned: Google Sheets backend behind `repo`. Note `Repo` is **synchronous** today and will need to become async.

## Notes

- `public/logo.webp` is the Katathani logo taken from the resort's public website, for the resort's own internal tool.
  Confirm with the resort's marketing team before wider distribution.
- Fonts load from Google Fonts (needs internet); the UI falls back to system fonts offline.
