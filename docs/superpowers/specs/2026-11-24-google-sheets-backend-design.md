# Barcheck — Google Sheets Backend (design, draft for approval)

## Intent
ตอนนี้ข้อมูลอยู่ในเบราว์เซอร์ของแต่ละเครื่อง (localStorage) ไม่ซิงก์ข้ามเครื่อง และฝ่ายสรุปยอดดูไม่ได้
ผู้ใช้เลือก **Google Sheets** เป็น backend เพื่อให้ฝ่ายสรุปยอดเปิดดู/สรุปเองใน Sheets/Excel ได้ทันที

## Goals
- ข้อมูลที่พนักงานกรอกขึ้น Google Sheet อัตโนมัติ (บาร์ × วัน × สินค้า) ดูรายเดือนได้โดยไม่ต้องรวมมือ
- ใช้งานได้แม้เน็ตที่บาร์หลุด: กรอกต่อได้ แล้วซิงก์ทีหลัง ไม่ทำข้อมูลหาย
- แก้ **ขนาดขวด (oz) ของสินค้า** ได้ในชีตเอง (แท็บ Items) โดยไม่ต้องแก้โค้ด
- หน้าจอเดิมไม่ต้องรื้อ

## Non-goals (v1)
- ไม่มีการแก้ไขพร้อมกันแบบเรียลไทม์ / ไม่มีหน้าแก้ความขัดแย้ง
- ไม่ใช้ Google ล็อกอินรายบุคคล (ดูข้อสมมติด้านล่าง)
- ไม่ย้ายข้อมูลเก่าจาก localStorage อัตโนมัติ (มีปุ่มส่งขึ้นครั้งเดียวถ้าจำเป็น)

## Architecture
React app → **sync layer (write-behind)** → **Google Apps Script Web App** → **Google Sheet**

- `repo` เดิม (localStorage, sync) ยังเป็นแหล่งความจริงในเครื่อง หน้าจอทั้ง 5 ไฟล์ที่เรียกใช้ไม่ต้องเปลี่ยนมาก
- ทุก `saveReport/saveReq` เขียน localStorage ทันที แล้วใส่คิวส่งขึ้น Apps Script (ลองใหม่เมื่อมีเน็ต)
- เข้าหน้าบาร์/เดือนใด ดึงข้อมูลจากชีตมารวมเข้า localStorage หนึ่งครั้ง (`repo.load(barId, month)`) มีสถานะ "กำลังซิงก์ / ค้างส่ง N รายการ / ซิงก์แล้ว" ที่หัวหน้า
- Apps Script ใช้ `LockService` กันเขียนชนกัน และ **upsert** ตามคีย์ (barId, date, itemCode); ชนกันใช้ `updatedAt` ใหม่กว่าชนะ (last-write-wins ระดับแถว)

## Sheet layout (ไฟล์ Google Sheet ไฟล์เดียว)
- **Reports** (แถวต่อสินค้าที่ "ถูกแตะ"): barId, date, itemCode, itemName, category, sizeOz, openBtl, openOz, dailyStoreOz, transferInOz, transferOutOz, saleOz, countedBtl, countedOz, remark, openFrom, status(draft|saved), reportBy, updatedAt
- **Requisitions**: barId, date, itemCode, itemName, qty, requestedBy, approvedBy, issuedBy, status, updatedAt
- **Items**: code, name, category, form(bar|requisition), sizeOz, active — แอปดึงรายการ+ขนาดจากแท็บนี้ (ใช้ JSON ที่มากับแอปเป็น fallback ถ้าโหลดไม่ได้)
- **Summary** (สูตร/Pivot ให้ฝ่ายสรุปยอด): ยอดรับ/โอนออก/ขาย/เฉลี่ยต่อวัน รายเดือนต่อบาร์ต่อสินค้า (ตรงกับหน้า Monthly ของแอป)

## Authentication (ข้อสมมติของผู้ออกแบบ — ต้องยืนยัน)
- Web App ติดตั้งแบบ "Execute as me, access: Anyone with the link" และแอปส่ง **access key รายบาร์** (สตริงสุ่มยาว เก็บในเครื่อง) ที่สคริปต์ตรวจก่อนอ่าน/เขียน
- ข้อดี: พนักงานไม่ต้องมีบัญชี Google; ข้อเสีย: ความปลอดภัยระดับ "ลับเฉพาะใครมีคีย์" เหมาะกับใช้ภายใน ไม่เหมาะกับข้อมูลอ่อนไหว; ต้องมีวิธีเปลี่ยนคีย์เมื่อพนักงานออก
- ทางเลือกที่แข็งแรงกว่า (แต่ยุ่งกว่า): ให้พนักงานล็อกอินด้วยบัญชี Google ของโรงแรม (Workspace)

## Constraints / limits ที่ต้องรู้
- โควตา Apps Script (เวลา/จำนวนเรียกต่อวัน) พอสำหรับ 12 บาร์ × บันทึกไม่กี่ครั้งต่อวัน; ส่งแบบรวมกลุ่ม (batch) ต่อบาร์/วัน ไม่ส่งทีละช่อง
- Apps Script ตอบช้า (~1–3 วินาที) → UI ต้องไม่รอ ซิงก์เบื้องหลังเท่านั้น
- เปลี่ยนขนาดขวดหลังมีข้อมูลแล้วยังทำให้ยอดย้อนหลังเพี้ยน (เก็บเป็นขวด+oz) — แท็บ Items ควรมีคำเตือน และ `sizeOz` ที่บันทึกในแถว Reports เป็นของวันนั้น (snapshot) เพื่อกันเพี้ยน (**ข้อเสนอ:** บันทึก sizeOz ลงแต่ละแถวตอนส่ง)

## Approaches considered
- **A. Apps Script Web App + write-behind sync (เลือก)** — ไม่มีเซิร์ฟเวอร์ ฟรี ฝ่ายสรุปยอดเห็นชีตสด; แลกด้วยความเร็วและความปลอดภัยที่หยาบ
- B. Google Sheets API ตรงจากเบราว์เซอร์ (OAuth) — ต้องให้ทุกคนล็อกอิน Google, ซับซ้อนกว่า
- C. Supabase/Firebase แล้ว export ลง Sheets — แข็งแรงกว่าแต่เพิ่มระบบอีกตัว (ผู้ใช้เลือก Sheets แล้ว)

## Rough task list (หลังอนุมัติจึงเขียนแผนละเอียด)
1. Apps Script: `doGet(load)`, `doPost(upsert)`, ตรวจคีย์, LockService, batch upsert, แท็บ Items — พร้อมสคริปต์ตั้งต้นชีต
2. Frontend: คิวซิงก์ (localStorage) + retry + ตัวบอกสถานะ + `repo.load` + โหลด Items จากชีต (fallback JSON)
3. เพิ่ม `sizeOz` snapshot ในแถว Reports และใช้ตอนคำนวณหน้า Monthly
4. หน้าตั้งค่า (ใส่ URL สคริปต์ + access key ของบาร์) + เอกสารติดตั้ง
5. เทสต์: คิวซิงก์/เน็ตหลุด/ชนกัน (mock fetch) และสคริปต์ทดสอบ Apps Script

## ต้องให้ผู้ใช้ตัดสินใจ
1. บัญชี Google/ชีตจะอยู่ภายใต้ใคร (Workspace ของโรงแรม หรือบัญชีส่วนตัว) และ IT โรงแรมอนุญาตไหม
2. ยอมรับการยืนยันตัวตนแบบ access key รายบาร์ (ง่าย) หรือต้องล็อกอินรายบุคคล (แข็งแรงกว่า)
3. ให้แก้ขนาดขวดในแท็บ Items ได้เลย (ข้อเสนอ) ใช่ไหม
