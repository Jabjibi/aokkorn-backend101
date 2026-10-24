# เส้น API อยู่ไฟล์ไหน

เริ่มดูจากไฟล์นี้: เลือก URL แล้วคลิกไฟล์ controller ด้านขวา ในโค้ดมี URL เต็มและ input/output อยู่เหนือแต่ละ endpoint

มี API ธุรกิจ 25 เส้น + LINE Login 4 เส้น + health 1 เส้น ทุกเส้นใช้ session ยกเว้น start/callback และ health

| Method | URL เต็ม                                                             | ไฟล์ controller                                                                                              |
| ------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| GET    | `/api/v1/auth/line/callback`                                         | [src/api/line-login/line-login.controller.ts](./src/api/line-login/line-login.controller.ts)                 |
| GET    | `/api/v1/auth/line/start`                                            | [src/api/line-login/line-login.controller.ts](./src/api/line-login/line-login.controller.ts)                 |
| POST   | `/api/v1/auth/logout`                                                | [src/api/line-login/line-login.controller.ts](./src/api/line-login/line-login.controller.ts)                 |
| GET    | `/api/v1/auth/me`                                                    | [src/api/line-login/line-login.controller.ts](./src/api/line-login/line-login.controller.ts)                 |
| GET    | `/api/v1/currencies`                                                 | [src/api/currencies/currencies.controller.ts](./src/api/currencies/currencies.controller.ts)                 |
| GET    | `/api/v1/exchange-rates/quote`                                       | [src/api/exchange-rates/exchange-rates.controller.ts](./src/api/exchange-rates/exchange-rates.controller.ts) |
| GET    | `/api/v1/trips`                                                      | [src/api/trips/trips.controller.ts](./src/api/trips/trips.controller.ts)                                     |
| POST   | `/api/v1/trips`                                                      | [src/api/trips/trips.controller.ts](./src/api/trips/trips.controller.ts)                                     |
| DELETE | `/api/v1/trips/:tripId`                                              | [src/api/trips/trip-lifecycle.controller.ts](./src/api/trips/trip-lifecycle.controller.ts)                   |
| GET    | `/api/v1/trips/:tripId`                                              | [src/api/trips/trips.controller.ts](./src/api/trips/trips.controller.ts)                                     |
| PATCH  | `/api/v1/trips/:tripId`                                              | [src/api/trips/trip-lifecycle.controller.ts](./src/api/trips/trip-lifecycle.controller.ts)                   |
| POST   | `/api/v1/trips/:tripId/days`                                         | [src/api/trip-days/trip-days.controller.ts](./src/api/trip-days/trip-days.controller.ts)                     |
| PATCH  | `/api/v1/trips/:tripId/days/:dayId`                                  | [src/api/trip-days/trip-days.controller.ts](./src/api/trip-days/trip-days.controller.ts)                     |
| GET    | `/api/v1/trips/:tripId/days/:dayId/expenses`                         | [src/api/expenses/expenses.controller.ts](./src/api/expenses/expenses.controller.ts)                         |
| POST   | `/api/v1/trips/:tripId/expenses`                                     | [src/api/expenses/expenses.controller.ts](./src/api/expenses/expenses.controller.ts)                         |
| DELETE | `/api/v1/trips/:tripId/expenses/:expenseId`                          | [src/api/expenses/expenses.controller.ts](./src/api/expenses/expenses.controller.ts)                         |
| GET    | `/api/v1/trips/:tripId/expenses/:expenseId`                          | [src/api/expenses/expenses.controller.ts](./src/api/expenses/expenses.controller.ts)                         |
| PATCH  | `/api/v1/trips/:tripId/expenses/:expenseId`                          | [src/api/expenses/expenses.controller.ts](./src/api/expenses/expenses.controller.ts)                         |
| POST   | `/api/v1/trips/:tripId/expenses/parse`                               | [src/api/expenses/expenses.controller.ts](./src/api/expenses/expenses.controller.ts)                         |
| POST   | `/api/v1/trips/:tripId/expenses/preview`                             | [src/api/expenses/expenses.controller.ts](./src/api/expenses/expenses.controller.ts)                         |
| DELETE | `/api/v1/trips/:tripId/obligations/:obligationId/settlement`         | [src/api/obligations/obligations.controller.ts](./src/api/obligations/obligations.controller.ts)             |
| PUT    | `/api/v1/trips/:tripId/obligations/:obligationId/settlement`         | [src/api/obligations/obligations.controller.ts](./src/api/obligations/obligations.controller.ts)             |
| POST   | `/api/v1/trips/:tripId/obligations/:obligationId/settlement/preview` | [src/api/obligations/obligations.controller.ts](./src/api/obligations/obligations.controller.ts)             |
| POST   | `/api/v1/trips/:tripId/participants`                                 | [src/api/participants/participants.controller.ts](./src/api/participants/participants.controller.ts)         |
| DELETE | `/api/v1/trips/:tripId/participants/:participantId`                  | [src/api/participants/participants.controller.ts](./src/api/participants/participants.controller.ts)         |
| PATCH  | `/api/v1/trips/:tripId/participants/:participantId`                  | [src/api/participants/participants.controller.ts](./src/api/participants/participants.controller.ts)         |
| POST   | `/api/v1/trips/:tripId/restore`                                      | [src/api/trips/trip-lifecycle.controller.ts](./src/api/trips/trip-lifecycle.controller.ts)                   |
| GET    | `/api/v1/trips/:tripId/summary`                                      | [src/api/summary/summary.controller.ts](./src/api/summary/summary.controller.ts)                             |
| GET    | `/api/v1/trips/deleted`                                              | [src/api/trips/trip-lifecycle.controller.ts](./src/api/trips/trip-lifecycle.controller.ts)                   |
| GET    | `/health`                                                            | [src/api/health/health.controller.ts](./src/api/health/health.controller.ts)                                 |

Controller รับ HTTP → service จัดการ use case → repository อ่าน/เขียนฐานข้อมูล คำขอ JSON ตัวอย่างและรายละเอียดอยู่ [docs/API.md](./docs/API.md)
