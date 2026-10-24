# Backend tests แยกตาม feature

| โฟลเดอร์          | ทดสอบส่วนไหน                                                                                        |
| ----------------- | --------------------------------------------------------------------------------------------------- |
| `app/`            | root controller และ root HTTP endpoint                                                              |
| `line-login/`     | LINE config/client/cookies/session transaction และ HTTP auth                                        |
| `trips/`          | list/create/lifecycle, owner access, quota, soft delete/restore/day numbering                       |
| `participants/`   | guest input และสิทธิ์ fields ที่ส่งได้                                                              |
| `trip-days/`      | optional/default name และ rename validation                                                         |
| `expenses/`       | ExpenseInput, parse/preview/CRUD, paid locks, original/converted money, cross-trip IDs และ rollback |
| `obligations/`    | settlement request contracts; flow pay/unpay ร่วมอยู่ใน expenses integration                        |
| `summary/`        | ยอดรายวัน/ทริป หลายสกุล และไม่หักกลบภาระสวนทาง                                                      |
| `currencies/`     | reference metadata และ minor-unit digits                                                            |
| `exchange-rates/` | HMAC quotes, owner/pair/expiry/tamper, Lambda errors และ provider adapter                           |
| `health/`         | readiness และซ่อน connection errors                                                                 |
| `common/`         | input/money rules, precision, rounding, split, redirect/error contract                              |
| `business/`       | HTTP journey ที่เรียกครบ 25 business endpoints สำหรับรันเอง                                         |
| `support/`        | ประกอบ Nest testing module + PostgreSQL in-memory ไม่เปิด port                                      |
| `fixtures/`       | schema SQL สำเนาสำหรับ test เท่านั้น ไม่ใช่ production migration                                    |

`*.spec.ts` ใช้ pure rules, mocks หรือ PGlite (PostgreSQL ในหน่วยความจำ) ไม่อ่าน `.env` ไม่ใช้ Supabase ไม่เปิด server/port และไม่เรียก LINE/Lambda/provider จริง

`*.integration.spec.ts` ทดสอบ SQL/constraints/transactions ด้วย schema fixture จริงของแอปบน PostgreSQL in-memory ซึ่งมี connection เดียวและ serialize transactions การทดสอบนี้ยืนยัน flow/SQL/rollback แต่ยังไม่พิสูจน์การแข่งขันข้ามหลาย API processes/DB connections

`*.e2e-spec.ts` เปิด HTTP port ชั่วคราว แยกคำสั่งจากชุดปกติ ชุด business ใช้ PostgreSQL ในหน่วยความจำและ test-only mocked session ส่วน session guard จริงทดสอบแยกใน auth suite ไม่มี production auth bypass

## คำสั่ง

```sh
npm test                            # ทุกส่วนยกเว้น HTTP e2e
npm test -- test/trips               # Trips และ lifecycle
npm test -- test/expenses            # ค่าใช้จ่ายและ flow การจ่าย
npm test -- test/exchange-rates      # quote/provider
npm test -- test/common              # exact money/input/error
```

เมื่อพร้อมเปิด HTTP tests ให้รันเอง:

```sh
npm run test:e2e -- test/business     # journey 25 endpoints
npm run test:e2e -- test/line-login   # auth flow
npm run test:e2e                     # HTTP suites ทั้งหมด
```

ทุก credentials/provider responses ใน test เป็นข้อมูลจำลอง ห้ามใช้ schema fixture ไป reset ฐานข้อมูลจริง การเปลี่ยน production schema ต้องทำ migration ที่แยกต่างหากและตรวจ deployment เอง
