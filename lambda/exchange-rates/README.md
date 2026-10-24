# Lambda FX provider adapter

โค้ดนี้ทำตามแผน NestJS → AWS SDK/IAM → Lambda → provider โดย Lambda ไม่แตะ Supabase, session, quoteId หรือยอดค่าใช้จ่าย รับเพียงคู่สกุลเงินและคืน decimal rate กับ capturedAt

Provider ปัจจุบันคือ [Frankfurter v2](https://frankfurter.dev/) ที่อ่านข้อมูลอัตราอ้างอิงรายวัน ไม่ใช่ราคา real-time ตัว adapter อ่าน numeric rate token จาก raw JSON แล้วส่งเป็น string เพื่อไม่เสีย precision จาก Number → string

## Build และตั้งค่าเมื่อพร้อม deploy

```sh
npm run build:lambda
```

ได้ `dist/handler.js` ภายในโฟลเดอร์นี้ ให้นำไฟล์ดังกล่าวและ `package.json` ของโฟลเดอร์นี้ไว้ที่ root ของ zip แล้ว deploy Lambda ด้วย handler `handler.handler`, runtime `nodejs24.x`, timeout 7 วินาที Node.js runtime ที่รองรับอ้างอิง [เอกสาร AWS](https://docs.aws.amazon.com/lambda/latest/dg/lambda-nodejs.html) โค้ด handler ไม่มี dependency npm เพิ่มเติม

ยังไม่ได้ deploy Lambda ในงานนี้ ไม่มีการสร้าง IAM role/Function URL หรือเรียก provider จริงใน tests

Lambda execution role ต้องเข้าถึง internet ตาม network ที่ติดตั้งและสิทธิ์ logs พื้นฐานเท่านั้น ไม่มีสิทธิ์ฐานข้อมูล Backend ใช้ AWS SDK v3 default credential chain และสิทธิ์จำกัดเฉพาะ invoke function เช่น:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "lambda:InvokeFunction",
      "Resource": "arn:aws:lambda:ap-southeast-1:YOUR_ACCOUNT_ID:function:YOUR_FX_FUNCTION"
    }
  ]
}
```

ไม่ต้องเปิด public Function URL วิธี invoke อ้างอิง [AWS SDK v3 Lambda](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/javascript_lambda_code_examples.html)

## Environment ฝั่ง NestJS backend

เพิ่มใน `.env` ของ backend หรือ secret settings ของ deployment:

```dotenv
AWS_REGION=ap-southeast-1
FX_LAMBDA_FUNCTION_NAME=YOUR_FX_FUNCTION
FX_QUOTE_SECRET=REPLACE_WITH_A_RANDOM_SECRET_OF_AT_LEAST_32_BYTES
```

ให้ `FX_QUOTE_SECRET` เป็นค่า random คงที่อย่างน้อย 32 bytes ใช้เหมือนกันทุก API instance และไม่ส่งให้ frontend Production บังคับให้มี secret นี้ ถ้ายังไม่ได้ตั้งใน development จะออก key ชั่วคราวตอน boot ทำให้ quote เดิมไม่ผ่านหลัง restart

Credential ใช้ IAM role/default chain ถ้า host ที่ deploy ต้องใช้ access key ให้เก็บ `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` และ `AWS_SESSION_TOKEN` เมื่อเป็น temporary credentials ใน secret manager ของ backend ห้ามใส่ใน client env หรือ commit

`DATABASE_URL`, LINE settings และ callback ไม่ได้เปลี่ยนจากรอบก่อน การขาดค่า Lambda ไม่ขัดขวาง manual rate: `GET /api/v1/exchange-rates/quote` ตอบ `503 AOK-7003` ส่วนบันทึกด้วย `{ "manualRate": "0.23" }` ยังทำได้

Request Lambda `{ "fromCurrency": "JPY", "toCurrency": "THB" }` Response `{ "fromCurrency": "JPY", "toCurrency": "THB", "rate": "0.23", "capturedAt": "2026-10-23T00:00:00.000Z" }` เป็นตัวอย่างอัตรา ไม่ใช่อัตราปัจจุบัน backend ตรวจ pair/rate/เวลา/ขนาด payload อีกครั้งก่อนออก quote อายุ 5 นาที

Tests จำลอง fetch และ AWS transport ไม่ใช้ credentials จริงและไม่เสียค่า invocation
