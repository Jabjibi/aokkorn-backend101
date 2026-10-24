# Aokkorn API

API ธุรกิจตาม MVP มี 25 เส้น บวก auth 4 เส้น และ `GET /health` ส่วน root `/api/v1` จาก scaffold ยังอยู่แยกต่างหาก เอกสารนี้เป็นสัญญา backend; รอบนี้ยังไม่ได้เปิดปุ่มบันทึกหรือเปลี่ยน frontend

ทุกเส้นด้านล่างใช้ prefix `/api/v1` และ session cookie `HttpOnly` ที่ได้จาก LINE Login การเรียก fetch ต้องใช้ `credentials: 'include'` ทุก `POST/PATCH/PUT/DELETE` ต้องส่ง `X-CSRF-Token` จาก `/auth/me` และ Origin ที่อนุญาต รวมถึง preview ที่ไม่บันทึกข้อมูล

ไม่รับ owner/user ID จาก body/query ใช้ actor จาก SessionGuard เท่านั้น Body/query ต้องมีเฉพาะ fields ที่ระบุ Path ID ต้องเป็น UUID และ child ID ต้องอยู่ในทริปที่ผู้ใช้นั้นเป็นเจ้าของเสมอ

## รายการ endpoints

| Method | Path                                                          | Body/query                                  | ผลลัพธ์หลัก                                           |
| ------ | ------------------------------------------------------------- | ------------------------------------------- | ----------------------------------------------------- |
| GET    | `/currencies`                                                 | ไม่มี                                       | Currency[]: code, symbol, minorUnitDigits             |
| GET    | `/trips`                                                      | ไม่มี                                       | items, quota, totalsByCurrency                        |
| POST   | `/trips`                                                      | name, baseCurrency                          | 201 TripDetail พร้อมเจ้าของและวันแรก                  |
| GET    | `/trips/:tripId`                                              | ไม่มี                                       | TripDetail                                            |
| PATCH  | `/trips/:tripId`                                              | name? / baseCurrency? / exchangeSelections? | TripDetail ที่เปลี่ยนแล้ว                             |
| DELETE | `/trips/:tripId`                                              | ไม่มี                                       | id, deletedAt, restoreUntil                           |
| GET    | `/trips/deleted`                                              | ไม่มี                                       | items ของเจ้าของที่ยังไม่พ้น 30 วัน                   |
| POST   | `/trips/:tripId/restore`                                      | ไม่มี                                       | 200 TripDetail เมื่อกู้คืนได้และโควตาไม่เต็ม          |
| POST   | `/trips/:tripId/participants`                                 | displayName                                 | 201 participant; ไม่มีบัญชี LINE ของ guest            |
| PATCH  | `/trips/:tripId/participants/:participantId`                  | displayName                                 | participant ที่แก้แล้ว                                |
| DELETE | `/trips/:tripId/participants/:participantId`                  | ไม่มี                                       | id, deleted: true                                     |
| POST   | `/trips/:tripId/days`                                         | name? หรือ {}                               | 201 day; ไม่ส่งชื่อได้ วัน N                          |
| PATCH  | `/trips/:tripId/days/:dayId`                                  | name                                        | day ที่แก้แล้ว                                        |
| GET    | `/trips/:tripId/days/:dayId/expenses`                         | ไม่มี                                       | items, total, originalTotals                          |
| POST   | `/trips/:tripId/expenses/parse`                               | text, currency                              | 200 name, amount; ไม่มีการบันทึก                      |
| POST   | `/trips/:tripId/expenses/preview`                             | ExpenseInput                                | 200 draft พร้อม shares/obligations/FX; ไม่มีการบันทึก |
| POST   | `/trips/:tripId/expenses`                                     | ExpenseInput                                | 201 ExpenseView พร้อม children ทั้งชุด                |
| GET    | `/trips/:tripId/expenses/:expenseId`                          | ไม่มี                                       | ExpenseView                                           |
| PATCH  | `/trips/:tripId/expenses/:expenseId`                          | partial ExpenseInput อย่างน้อยหนึ่ง field   | ExpenseView ที่แก้แล้ว                                |
| DELETE | `/trips/:tripId/expenses/:expenseId`                          | ไม่มี                                       | id, deleted: true                                     |
| GET    | `/trips/:tripId/summary`                                      | ไม่มี                                       | trip, days, expenses, obligations, totals             |
| GET    | `/exchange-rates/quote`                                       | query: from, to                             | quoteId, rate, source, capturedAt, expiresAt, คู่สกุล |
| POST   | `/trips/:tripId/obligations/:obligationId/settlement/preview` | currency, exchange?                         | 200 originalAmount, expectedPaidAmount, fxSnapshot    |
| PUT    | `/trips/:tripId/obligations/:obligationId/settlement`         | paidAmount, exchange?                       | obligation สถานะ paid และ settlement                  |
| DELETE | `/trips/:tripId/obligations/:obligationId/settlement`         | ไม่มี                                       | obligation สถานะ unpaid; settlement: null             |

GET ทุกเส้นยกเว้น quote ไม่รับ query ส่วนคำขอที่ไม่มี body ส่งว่างหรือ {} ได้ ไม่รับฟิลด์อื่น

## Money และการหาร

```json
{
  "dayId": "UUID-from-trip-details",
  "name": "อาหาร",
  "amount": { "minor": "100001", "currency": "THB" },
  "payerParticipantId": "payer-UUID",
  "participantIds": ["guest-UUID"]
}
```

ตัวอย่าง body ข้างบนเป็น ExpenseInput ใช้ได้กับ create/preview โดยเปลี่ยน placeholder เป็น UUID จริง ยอด `100001` THB หมายถึง 1,000.01 บาท ค่า minor ต้องเป็น string จำนวนเต็มบวก สูงสุด 9223372036854775807; ไม่รับ floating point/รูป scientific

`participantIds: []` หมายถึงเลือกเฉพาะ payer ระบบเพิ่ม payer เสมอ แต่ไม่เลือก guest อัตโนมัติ ลำดับหารคือ payer ก่อน แล้ว sortOrder/id ยอด 1 หน่วยที่หารสามคนจึงเป็น 1/0/0 ไม่มี obligation ยอดศูนย์ และไม่มี obligation ของ payer

ExpenseView มี id, tripId, dayId, name, amount, payerParticipantId, participantIds, shares, obligations, fxSnapshot, createdAt และ updatedAt Shares มี participantId, amount, converted, splitOrder ภาระมี id, expenseId, debtorParticipantId, creditorParticipantId, amount, converted, status, settlement, createdAt และ updatedAt ไม่หักกลบภาระสวนทางกัน

`converted` เป็น Money ในสกุลหลักของทริป ส่วน `amount` เป็นยอดต้นทาง อัตราและเงินคำนวณด้วย integer/decimal string ยอดแปลงปัด half-up ครั้งเดียวต่อยอด ค่าแปลงของแต่ละส่วนอาจรวมแล้วต่างจากค่าแปลงทั้งรายการจากการปัดเศษ ห้ามใช้แทนยอดต้นทาง

`POST .../expenses/parse` รับเช่น `{ "text": "น้ำ 3 ขวด 1,250.50", "currency": "THB" }` ใช้ token จำนวนเงินท้ายข้อความหลัง whitespace; ได้ชื่อ น้ำ 3 ขวด และ minor 125050 ตรวจ comma/ทศนิยมตาม metadata สกุล JPY ไม่รับทศนิยม

## FX และการเปลี่ยนสกุลหลัก

รายการต่างสกุลต้องมี `exchange: { "manualRate": "0.23" }` หรือ `{ "quoteId": "..." }` อย่างใดอย่างหนึ่ง Rate หมายถึง 1 หน่วยหลักต้นทางเป็นกี่หน่วยหลักปลายทาง เช่น JPY → THB = 0.23 ไม่รับ source/capturedAt/converted จาก client

Quote ผ่าน Lambda มีลายเซ็น ผูก owner/pair และอายุ 5 นาที Backend ไม่เรียก provider ระหว่างบันทึก หาก Lambda ไม่พร้อมยังบันทึกด้วย manualRate ได้ การขอ quote จำกัด 20 คำขอต่อนาทีต่อ IP/route ใน API process

PATCH เปลี่ยนสกุลหลักส่งอัตราครบทุกสกุลต้นทางที่ต่างจากสกุลใหม่:

```json
{
  "baseCurrency": "USD",
  "exchangeSelections": {
    "JPY": { "manualRate": "0.0067" },
    "THB": { "manualRate": "0.03" }
  }
}
```

ระบบคำนวณ current snapshot ใหม่ทั้งชุดใน transaction เดียว เก็บ snapshot เก่าไว้เป็นประวัติ ไม่แก้ยอดต้นทาง shares/obligations หรือ settlement เดิม เปลี่ยน base currency ได้แม้มี obligation ที่ paid เพราะเปลี่ยนเฉพาะบริบทการแสดง

PATCH expense ที่เปลี่ยนยอด/คนหาร/ผู้จ่าย/สกุล/อัตรา สร้างส่วนแบ่งใหม่ทั้งชุดและรักษา obligation id ของ debtor เดิมเมื่อยังอยู่ ถ้าเปลี่ยนยอดแต่คู่สกุลเดิมและไม่ส่ง exchange จะใช้อัตราเดิม ไม่แอบดึงอัตราใหม่ หากมี obligation paid ต้องย้อน unpaid ก่อน การแก้ชื่อหรือย้ายวันยังทำได้โดยไม่แก้ children

## การจ่ายและสรุป

Preview settlement รับ currency และ selection ส่วน PUT รับ paidAmount จริง อาจต่างจากยอดคาดการณ์เพราะค่าธรรมเนียมหรือการปัดเศษ ระบบเก็บทั้งคู่ การทำ paid หมายถึงยืนยันเต็ม obligation ตามที่ UI แสดง ไม่รองรับ partial payment

PUT เดิมซ้ำเป็น no-op และคง paidAt เดิม แม้ quote เดิมหมดอายุหลังการจ่ายแล้วก็ยังตรวจลายเซ็น/owner/pair ก่อนยอมรับ คำขอที่เปลี่ยนยอด/อัตราหลัง paid ตอบ AOK-8104 ต้อง DELETE settlement เพื่อกลับ unpaid แล้วจ่ายใหม่ DELETE ซ้ำขณะ unpaid เป็น no-op

Summary คืน trip, total, originalTotals, days, expenses, obligations และ obligationTotals `{ paid: Money[], unpaid: Money[] }` โดย obligations แต่ละแถวเพิ่ม expenseName/dayId เสมอ ยอดรวมแยกสกุลและสถานะ แต่ไม่ net ยอดระหว่าง debtor/creditor

## Limits, transaction และ errors

- ชื่อทริป/ผู้ร่วมทริป/วันไม่เกิน 80 Unicode code points; ชื่อรายการไม่เกิน 200; text parse ไม่เกิน 2048 code units; participantIds ไม่เกิน 1000 รายการต่อคำขอ ไม่มีโควตา guest ทางผลิตภัณฑ์เพิ่มเติม
- Trim ชื่อและปฏิเสธชื่อว่าง/control characters ไม่รับ field ระบบ และไม่ coerce number เป็น string ของเงิน
- สร้าง/กู้ทริปล็อก user แถวเดียวกันก่อนตรวจโควตา 5 ทริป ใช้ READ COMMITTED; การแก้ข้อมูลในทริปล็อก trip ก่อนเขียน จึงกันการแก้ expense/settlement กับการลบ participant หรือเปลี่ยน base currency พร้อมกัน
- อ่านหลายตารางใช้ REPEATABLE READ READ ONLY; การเขียนเป็น transaction รวม children ทั้งชุด ไม่เหลือข้อมูลครึ่งรายการ
- ไม่พบ/ของคนอื่น/ทริปถูกลบเป็น AOK-2001; child ของทริปอื่นใช้ not-found code ของ child หลังตรวจสิทธิ์ทริป
- Error envelope `{ statusCode, errorCode, message, details, traceId }`; frontend ใช้ errorCode แทนข้อความ รายการรหัสอยู่ `src/common/api-error.filter.ts` ตรง spec
- โควตาสร้างเต็ม AOK-2101, กู้คืนเต็ม AOK-2102, เกิน 30 วัน AOK-2103, ลบเจ้าของ AOK-3202, มี references AOK-3201, paid lock AOK-5401, quote หมดอายุ AOK-7006

## Health และการตรวจสอบ

`GET /health` อยู่ที่ root ไม่มี prefix/session ใช้ SELECT 1 ตรวจ readiness คืน `{ "status": "ok", "database": "up" }`; ไม่พร้อมตอบ 503 โดยไม่คืน connection details

Tests แยกตาม feature ที่ [test/README.md](../test/README.md) ชุดปกติไม่เปิด port: pure rules + mocked providers + PostgreSQL in-memory ที่ใช้ schema fixture ตรง migration ส่วน HTTP e2e เตรียมไว้ให้ผู้ใช้รันเอง รวม journey ที่เรียกครบ 25 เส้น

ยังต้อง smoke test กับ Supabase schema/role/TLS ที่ deploy จริงและ Lambda ที่ตั้งค่าแล้ว รวมทั้งทดสอบ row locking แบบหลาย PostgreSQL connections/API instances จริง PGlite ใน test มี connection เดียวและ serialize transactions จึงยืนยัน SQL/rollback/flow แต่ไม่ใช่หลักฐาน concurrency หลาย process ข้อมูลใน browser เดิมไม่มีการ migrate หรือ sync อัตโนมัติ
