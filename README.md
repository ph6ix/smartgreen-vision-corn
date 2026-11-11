# 🌽 สมาร์ทกรีน Vision Ai วิเคราะห์ใบข้าวโพด

ถ่ายภาพใบข้าวโพด 3 ตำแหน่ง (+ ทั้งต้น / ฝัก ไม่บังคับ) ให้ AI (Gemini) ช่วยประเมิน
- **ธาตุอาหาร 8 ธาตุ**: N, P, K, Mg, S, Zn, B, Mn
- **โรคและแมลง**: หนอนกระทู้ข้าวโพดลายจุด, โรคราน้ำค้าง, ใบไหม้แผลใหญ่/แผลเล็ก, ราสนิม, หนอนเจาะลำต้น, ลำต้นเน่า ฯลฯ
- **แผนปุ๋ย** ต่อไร่ตามอายุและชนิดดิน และสิ่งที่ควรทำทันที

เว็บ: https://smartgreen-vision-corn.vercel.app · หน้าแรกรวมพืช: https://smartgreen-vision-ai-home.vercel.app

> ⚠️ ความรู้อ้างอิงและสูตรปุ๋ยในคำสั่ง AI (`lib/cornService.js`) เป็น **ร่าง** จากหลักวิชาการทั่วไป
> ต้องให้ทีมนักวิชาการสมาร์ทกรีนตรวจทานก่อนเปิดใช้กับลูกค้า

## ตำแหน่งภาพ

| ช่อง | ตำแหน่ง | ใช้ดู |
| --- | --- | --- |
| `young` | ใบอ่อน / ยอด | Zn, S, B, Mn · ราน้ำค้าง · หนอนกระทู้ |
| `mature` | ใบมาตรฐาน | N, P, K, Mg (ตัวแทนทั้งต้น) |
| `old` | ใบล่าง / ใบแก่ | N, K, Mg · ใบไหม้ · ราสนิม |
| `tree` (ไม่บังคับ) | ทั้งต้น / ฝัก | หนอนเจาะ · ลำต้นเน่า · ฝักไม่เต็ม |

## โครงสร้าง

| ส่วน | หน้าที่ |
| --- | --- |
| `public/` | หน้าเว็บ: `index.html` (ตรวจใบ), `report.html` (ใบรายงาน A4 + บันทึกรูป), `js/`, `css/`, `assets/` |
| `api/analyze.js` | ฟังก์ชัน Vercel: รับภาพ → `lib/cornService.js` |
| `api/save-sheet.js` | บันทึกผลลง Google Sheets (`lib/sheets.js`, `gas/Code.gs`) |
| `lib/cornService.js` | คำสั่ง AI, ตรวจภาพก่อนวิเคราะห์, จัดรูปผล |
| `lib/cornProducts.js` | ผลิตภัณฑ์สมาร์ทกรีนที่อนุญาตให้ AI แนะนำ (ตอนนี้ว่าง รอฝ่ายวิชาการ) |
| `lib/gemini.js`, `lib/modelRetry.js` | เรียก Gemini พร้อมลองใหม่อัตโนมัติเมื่อระบบหนาแน่น |
| `server.js` | เปิดเว็บทดสอบในเครื่อง http://localhost:8080 |

## ตั้งค่า Vercel (Environment Variables)

| ชื่อ | ค่า |
| --- | --- |
| `GEMINI_API_KEY` | คีย์ Gemini (ใช้ตัวเดียวกับแอปอ้อย/ปาล์มได้) |
| `GOOGLE_SHEETS_WEBHOOK_URL` | (ไม่บังคับ) URL เว็บแอปจาก `gas/Code.gs` ของชีตข้าวโพด |

## รันในเครื่อง

```bash
cp .env.example .env   # ใส่ GEMINI_API_KEY
npm install
npm start
```

## เพิ่มผลิตภัณฑ์สมาร์ทกรีน
แก้ `lib/cornProducts.js` ตามตัวอย่างในไฟล์ และวางรูปสินค้าไว้ที่ `public/assets/`

## ที่มาภาพ
ดู `public/assets/samples/CREDITS.md`
