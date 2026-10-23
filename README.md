# Aokkorn backend

NestJS 12 + ESM สำหรับ API ของ Aokkorn เริ่มจาก LINE Login ใช้ Supabase PostgreSQL เก็บผู้ใช้และ session ของแอป ไม่ใช้ Supabase Auth

## เริ่มอ่านโค้ดจากที่ไหน

โค้ด login รวมอยู่ที่ `src/api/line-login/` ไม่มีโฟลเดอร์ย่อยหรือ abstract adapters ให้ตามหลายชั้น

| ไฟล์ | หน้าที่ |
| --- | --- |
| `line-login.controller.ts` | ประกาศ API รับ HTTP แล้วส่งคำตอบ/cookie/redirect |
| `line-login.service.ts` | logic หลัก: เริ่ม login → ตรวจ callback → LINE → บันทึก session รวมถึง me/logout |
| `line.client.ts` | เรียก LINE จริง สร้าง URL แลก code และตรวจ ID token |
| `line-login.repository.ts` | SQL อ่าน/เขียน users และ sessions พร้อม transaction |
| `line-login.config.ts` | อ่านและตรวจค่าจาก `.env` ตอนเริ่มแอป |
| `line-login.cookies.ts` | อ่าน ตั้ง และล้าง HttpOnly cookies |
| `session.guard.ts` | ตรวจ session ก่อนเข้า API และตรวจ CSRF สำหรับคำขอเปลี่ยนข้อมูล |
| `line-login.module.ts` | ลงทะเบียนและเชื่อมไฟล์ข้างบนให้ Nest ใช้งาน |

เริ่มอ่าน **controller → service → client/repository** ส่วน cookie/config/guard เป็นส่วนสนับสนุน

นอก feature มี `src/app.setup.ts` สำหรับตั้ง prefix/CORS/headers และ `src/common/api-error.filter.ts` สำหรับ error mapping และ JSON response ทั้งแอป `app.module.ts` ประกอบ modules ส่วน `main.ts` เปิด server

Nest Observe จาก scaffold ยังเป็น placeholder จึงเอาการเปิดใช้งาน placeholder ออกก่อน ไม่ส่ง auth telemetry ไปบริการภายนอก

## ตั้งค่า

1. ติดตั้งด้วย `npm ci`
2. ถ้ายังไม่มี `.env` ให้คัดลอก `.env.example` เป็น `.env`
3. ใส่ `LINE_CHANNEL_ID` และ `LINE_CHANNEL_SECRET` จาก **LINE Login channel**
4. ตั้ง callback ใน LINE Developers ให้ตรงกับ `LINE_CALLBACK_URL`: default `http://localhost:5016/api/v1/auth/line/callback`
5. ใส่ `DATABASE_URL` ของ Supabase PostgreSQL/session pooler พร้อม URL-encoded password ต้องเป็น URL PostgreSQL ไม่ใช่ Supabase REST URL หรือ anon key
6. หาก Supabase ใช้ CA เฉพาะ ใส่ public CA certificate ไว้ในโปรเจกต์แล้วกำหนด `DATABASE_CA_CERT_PATH` ระบบตรวจ certificate/hostname เสมอ ไม่ใช้ `rejectUnauthorized: false`; หากมี `sslmode` ใน URL ให้เป็น `verify-full`
7. ตั้ง `LINE_LOGIN_ENABLED=true` เมื่อค่าครบ แล้วรัน `npm run start:dev`

ระหว่างยังไม่ใส่ค่าจริง ใช้ `LINE_LOGIN_ENABLED=false` แอปเริ่มได้ แต่ auth จะตอบ 503 ไม่สร้างผู้ใช้จำลองให้ production

เชื่อม frontend แล้ว: `LOGIN_SUCCESS_URL=http://localhost:3000/dashboard` และ `LOGIN_FAILURE_URL=http://localhost:3000/?login=failed` ให้ origin ของ frontend อยู่ใน `ALLOWED_ORIGINS` ด้วย

`LINE_CALLBACK_URL` ยังคง `http://localhost:5016/api/v1/auth/line/callback` และต้องตรงกับ LINE Developers ทุกตัวอักษร ไม่ได้เปลี่ยนไปพอร์ต 3000 Browser ต้องใช้ hostname เดียวกันตลอด (เช่น localhost) เพื่อให้ cookie ติดไปกับคำขอ

เมื่อกำหนด failure URL ข้อผิดพลาดของ GET start/callback จะตอบ 303 กลับ modal บน frontend โดยไม่ใส่ OAuth code/state หรือ provider error ลง URL ส่วน me/logout และ routes อื่นยังตอบ JSON ตามเดิม หากไม่ตั้ง failure URL จะใช้ JSON contract เดิมทั้งหมด

Production ต้องเปิด LINE Login และใช้ HTTPS ทั้ง callback/success/origins Session cookie ใช้ Secure/HttpOnly/Path=/ และชื่อขึ้นต้น `__Host-` ค่า `SESSION_COOKIE_SAME_SITE=lax` เหมาะเมื่อ frontend/API อยู่ site เดียวกัน; หากคนละ site ใช้ `none` ใน production และ browser ต้องอนุญาต third-party cookies ส่วน OAuth flow cookie ใช้ Lax เพื่อรับ top-level callback จาก LINE

Session มีอายุคงที่ตาม `SESSION_TTL_HOURS` (default 168, สูงสุด 720 ชั่วโมง) ไม่เลื่อนเวลาจากการเรียก `/me` ต่ออายุด้วยการ login ใหม่ซึ่งออก session token ใหม่

## API

| Method | URL | ใช้งาน |
| --- | --- | --- |
| GET | `/api/v1/auth/line/start` | เปิดด้วย browser navigation เพื่อเริ่ม login; 302 ไป LINE |
| GET | `/api/v1/auth/line/callback` | LINE ส่ง code/state กลับมา; สำเร็จตั้ง session cookie และ 303 |
| GET | `/api/v1/auth/me` | อ่านผู้ใช้ปัจจุบันและ CSRF token; ต้องมี session |
| POST | `/api/v1/auth/logout` | เพิกถอน session และล้าง cookie; ต้องมี session, Origin และ X-CSRF-Token |

ตัวอย่าง `/me`:

```json
{
  "user": { "id": "opaque-user-id", "displayName": "ชื่อผู้ใช้" },
  "expiresAt": "2026-10-29T12:00:00.000Z",
  "csrfToken": "..."
}
```

Frontend เริ่ม login ด้วย `window.location.href = 'http://localhost:5016/api/v1/auth/line/start'` ใช้ browser เดิมจนจบ callback ส่วน fetch ไป API ใช้ `credentials: 'include'` และส่ง `X-CSRF-Token` ที่ได้จาก `/me` ตอน logout Browser ส่ง Origin เอง

ใช้ state/nonce/PKCE S256 และผูก state กับ browser cookie ใช้ state ครั้งเดียวรวมถึงการยกเลิก consent ตรวจ ID token ผ่าน LINE verify endpoint และตรวจ issuer/audience/expiry/nonce อีกครั้ง เก็บ session เฉพาะ SHA-256 hash ไม่เก็บ LINE access/refresh/ID token ไม่ส่ง raw session token ใน JSON

Error รูปแบบเดียวกัน `{ statusCode, errorCode, message, details, traceId }` เช่น `AOK-1101` callback ผิด, `AOK-1001` ไม่มี session, `AOK-1002` หมดอายุ, `AOK-1003` เพิกถอน, `AOK-1201` CSRF ผิด และ `AOK-9002` rate limit Frontend ใช้ errorCode ตัดสินใจ

## ฐานข้อมูล

ใช้ตารางตาม [Supabase schema ที่มีอยู่ในโปรเจกต์](../aokkorn/supabase/README.md) โดยไม่รัน migration/seed ตอน boot:

- `public.users`: `id` UUID default, `line_subject` UNIQUE, `display_name`, `created_at`, `updated_at`
- `public.sessions`: `id` UUID default, `user_id` FK, `token_hash` UNIQUE, `expires_at`, nullable `revoked_at`, `created_at`

DB role ต้องมีสิทธิ์ตาม RLS/schema สำหรับ SQL เหล่านี้ upsert user และ insert session อยู่ transaction เดียว เมื่อเกิดข้อผิดพลาด rollback ทั้งชุด งาน Supabase Cron ลบ session เก่าใช้ migration ของโปรเจกต์; guard ตรวจ expiry/revocation ทุก request โดยไม่รอ Cron

## ตรวจสอบ

```sh
npm test
npm run test:e2e
npm run build
npm run lint
npx tsc --noEmit --incremental false
```

Tests จำลอง LINE transport และ PostgreSQL ไม่ใช้ credentials จริง HTTP tests ใช้พอร์ตชั่วคราวบน 127.0.0.1 และปิดหลังทดสอบ ต้องทดสอบ LINE Login ผ่าน browser และ schema/transaction บนฐานข้อมูลจริงหลังใส่ credentials อีกครั้ง

OAuth flow และ rate limit อยู่ใน memory รองรับหนึ่ง API instance; ถ้า restart ระหว่าง login ให้เริ่มใหม่ ก่อน scale หลาย instance ต้องย้าย state/rate limit ไป shared storage ส่วน app sessions อยู่ PostgreSQL และคงอยู่หลัง restart

Feature ถัดไป import `LineLoginModule` และใช้ `@UseGuards(SessionGuard)` เพื่อบังคับ login/CSRF การตรวจเจ้าของข้อมูลต้องทำใน service/repository ของ feature นั้นเพิ่มเติม

อ้างอิง: [LINE Login](https://developers.line.biz/en/docs/line-login/integrate-line-login/), [LINE PKCE](https://developers.line.biz/en/docs/line-login/integrate-pkce/), [NestJS modules](https://docs.nestjs.com/modules)
