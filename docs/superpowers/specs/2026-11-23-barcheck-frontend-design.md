# Barcheck — Frontend Design (v1)

## Intent
พนักงานเช็กของหน้าบาร์ (12 บาร์ของโรงแรม) ปัจจุบันเขียนกระดาษแล้วนำไปพิมพ์ลง Excel ซ้ำ
ต้องการเว็บแอป React ที่กรอกได้ที่หน้างานทั้งมือถือและคอม บันทึกเป็นข้อมูลรายเดือนทันที
เพื่อให้ฝ่ายสรุปยอดไม่ต้องไล่ใบทีละแผ่น

## Goals
- กรอก **Bar Report** (เหล้า/เครื่องดื่ม) และ **Store Requisition** (ใบเบิกของ) ตามฟอร์มกระดาษใน PDF
- ใช้มือเดียวบนมือถือได้ ขณะเปิดบาร์
- ระบบคำนวณ Total / Closed ให้เอง ไม่ต้องคิดเลขขวด↔oz
- ข้อมูลทุกแถวถูกเก็บเป็น (บาร์ × วัน × สินค้า) เพื่อสรุปรายเดือนและ Export Excel

## Non-goals (v1)
- ไม่มี backend / login (เก็บใน localStorage ก่อน)
- ยังไม่ทำฟอร์ม Bar Central (วัตถุดิบผลไม้/น้ำผลไม้) — ไว้รอบถัดไป
- ยังไม่มีหน้าแก้ไขรายการสินค้าสำหรับ admin

## Anti-goals
- ใช้ยากกว่ากระดาษ (ต้องเลื่อนซ้ายขวา, ปุ่มเล็ก, กรอกผิดช่อง)
- ข้อมูลหายเมื่อปิดหน้าก่อนกดบันทึก → ต้องมี draft อัตโนมัติ

## Approaches considered
- **A. การ์ดต่อรายการ จัดกลุ่มตามหมวด (เลือก)** — เหมาะมือถือ ค้นหาง่าย; บนจอกว้างจัดเป็นตารางแน่นได้
- B. ตารางเหมือนกระดาษ — คุ้นตาแต่มือถือใช้ยาก
- C. ทีละรายการ — เร็วแต่ไม่เห็นภาพรวม

ผู้ใช้เลือก A

## Screens
1. **Home** — เลือกบาร์ (12) + วันที่; แสดงสถานะวันนี้ (ยังไม่กรอก / ร่าง / บันทึกแล้ว)
2. **Bar Report** — header (บาร์, วันที่, ผู้รายงาน), ช่องค้นหา, ตัวนับ "กรอกแล้ว x/y", หมวดพับได้ (Rum, Vodka, Scotch…), การ์ดต่อสินค้า, ปุ่มบันทึก
3. **Store Requisition** — หมวด Beverage / Food / General Store, กรอกจำนวนต่อรายการ, ช่อง Requested / Approved / Issued by
4. **Monthly Summary** — เลือกบาร์+เดือน, ตารางยอดรวมต่อสินค้า (รวม Transfer, Sale, ค่าเฉลี่ย), กดดูรายวัน, ปุ่ม Export Excel

## Bar Report card — fields & calculation
ต่อสินค้า: ชื่อ, Size (oz/ขวด, เช่น 23 หรือ 25)
กรอก: Open (ขวด+oz), Daily Store, Transfer In, Transfer Out, Sale (oz), Remark
คำนวณ (ทำงานภายใน oz แล้วแสดงเป็น ขวด+oz):
- Total₁ = Open + Daily Store + Transfer In
- Total₂ = Total₁ − Transfer Out
- Closed = Total₂ − Sale

> **สมมติฐาน (ผู้ออกแบบเดา ยังไม่ยืนยัน):** สูตรข้างต้นและหน่วยของ Sale เป็น oz อ่านจากหัวคอลัมน์ในฟอร์ม
> ถ้า Closed ต้องเป็นค่านับจริงของพนักงาน ให้กรอกเองแล้วระบบแสดงส่วนต่างเทียบกับค่าคำนวณ — ต้องให้ผู้ใช้ยืนยัน

## Data model (localStorage, พร้อมย้ายไป backend)
- `bars[]`: id, name
- `items[]`: code, name, category, sizeOz, form (`bar` | `requisition`)
- `reports[]`: barId, date (YYYY-MM-DD), reportBy, status (draft|saved), rows: `{itemCode, open, dailyStore, transferIn, transferOut, sale, closed, remark}`
- `requisitions[]`: barId, date, rows `{itemCode, qty}`, requestedBy, approvedBy, issuedBy
- คีย์ไม่ซ้ำ: (barId, date, form) — เปิดซ้ำคือแก้ใบเดิม

## Constraints / my calls
- Vite + React + TypeScript, react-router, SheetJS สำหรับ Export; ไม่ใช้ UI library หนัก (CSS ธรรมดา/CSS variables)
- Mobile-first, ปุ่ม ≥ 44px, ตัวเลขใช้ `inputmode="decimal"`
- รองรับภาษาไทย/อังกฤษในชื่อสินค้า
- รายการสินค้าตั้งต้นดึงจาก `Bar_Centrals.xlsm` / `BAR_Reports.xlsx` / PDF เป็น seed data (แปลงเป็น JSON); รายการต่างกันต่อบาร์ได้
- ข้อมูลต่อบาร์ที่ยังไม่มี Par Stock หรือ Par เป็นข้อความ แสดงตามที่มี ไม่บังคับ

## Left to the builder
ธีมสี/ฟอนต์, รายละเอียด layout บนจอกว้าง, การแปลง seed data, โครงสร้างโฟลเดอร์
