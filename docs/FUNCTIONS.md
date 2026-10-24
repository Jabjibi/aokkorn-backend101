# โครงสร้างและสัญญา functions

อ่านหนึ่ง feature ตาม **controller → service → repository** Controller ใช้ SessionGuard และ pipes รับ validated DTO แล้วส่ง actor จาก session ให้ service ไม่มี business logic/SQL ใน controller กฎที่คำนวณได้โดยไม่ทำ I/O แยกเป็น pure functions

```text
src/
├── api/
│   ├── line-login/       # auth/session เดิม
│   ├── trips/            # list/create/detail + lifecycle + owner/transaction boundary
│   ├── participants/     # guest CRUD
│   ├── trip-days/        # create/rename days
│   ├── expenses/         # parse/split/preview/CRUD + batch read model
│   ├── obligations/      # preview/pay/unpay
│   ├── summary/          # ประกอบยอด/ภาระจาก snapshot เดียว
│   ├── currencies/       # currency reference metadata
│   ├── exchange-rates/   # signed quotes, Lambda transport, snapshot persistence
│   └── health/           # readiness
├── common/
│   ├── input.ts          # shared strict parsers และ pipes
│   ├── money.ts          # integer/decimal money
│   └── api-error.filter.ts
└── database/             # pool และ transaction เดียวร่วมทุก feature
lambda/exchange-rates/     # provider adapter; ไม่มี DB/session/business rules
```

## Pure และ boundary helpers

| Function                                                         | Input → Output                                      | Pure / dependency                                | ทดสอบตรงไหน                         |
| ---------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------ | ----------------------------------- |
| objectInput / invalid                                            | unknown + allowed fields → record/error             | Pure, whitelist                                  | tests DTO แต่ละ feature             |
| nameInput / currencyInput / idInput                              | unknown → normalized string/error                   | Pure                                             | tests DTO และ HTTP input            |
| BodyPipe.transform / IdPipe.transform / EmptyQueryPipe.transform | raw body/path/query → validated value/void          | Pure boundary                                    | DTO tests; HTTP e2e                 |
| moneyInput                                                       | unknown → positive Money/error                      | Pure; BigInt                                     | test/common/money.spec.ts           |
| rateInput                                                        | unknown → canonical decimal string                  | Pure; จำกัด numeric(30,15)                       | test/common/money.spec.ts           |
| convertMinor                                                     | minor/rate/sourceDigits/targetDigits → minor string | Pure; half-up; ไม่มี Number เงิน                 | test/common/money.spec.ts           |
| sumMoney / totalsByCurrency                                      | Money[] / TripView[] → ยอดแยกสกุล                   | Pure; ไม่ net debts                              | money/trips tests                   |
| parseCreateTrip / updateTripInput                                | unknown → DTO                                       | Pure                                             | trips tests                         |
| participantInput / createDayInput / updateDayInput               | unknown → ชื่อหรือ optional default                 | Pure                                             | participants/trip-days tests        |
| expenseInput / expensePatchInput / parseTextInput                | unknown → ExpenseInput/patch/parse DTO              | Pure                                             | expenses DTO tests                  |
| exchangeInput / quoteQuery                                       | unknown → selection หรือ pair query                 | Pure                                             | exchange-rates tests                |
| settlementInput / settlementPreviewInput / emptyBody             | unknown → payment DTO/void                          | Pure                                             | obligations DTO/HTTP tests          |
| parseExpenseText                                                 | text/currency/digits → name/Money                   | Pure; trailing token                             | money tests                         |
| splitExpense                                                     | amount/payer/selected/people → deterministic shares | Pure; payer first; รักษาผลรวม                    | money tests                         |
| tripView / snapshot / obligation / view helpers                  | DB rows → public DTO                                | Pure; แปลง Date เป็น ISO ไม่คืน DB system fields | integration flow ผ่าน public output |

## Use cases ที่มี I/O

Functions ในตารางนี้ไม่ pure เพราะอ่าน/เขียน DB, ใช้เวลา/signing key หรือเรียก provider ทดสอบผ่าน dependency injection โดยไม่ต้องเปิด server

| Class / methods                                    | Input → Output                                          | สิ่งที่ทำ / ขอบ transaction                                     |
| -------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------- |
| TripsService.list/create/detail                    | actor + input/id → list/quota/TripDetail                | เรียก TripsRepository; ไม่มี cookie/SQL                         |
| TripAccessService.run                              | actor/trip/write/callback → result                      | transaction + owner filter + optional trip row lock             |
| TripLifecycleService.deleted/remove/restore/update | actor/trip/patch → result                               | soft delete/recovery quota/base conversion; ไม่มี client owner  |
| ParticipantsService.create/update/remove           | actor/trip/id/name → participant/deleted                | ตรวจสิทธิ์+lock ผ่าน TripAccess; repository ตรวจ references     |
| TripDaysService.create/update                      | actor/trip/id/name → day                                | lock trip ก่อนออก sortOrder                                     |
| ExpensesService.parse                              | actor/trip/text → draft                                 | read-only + currency metadata + pure parser                     |
| ExpensesService.preview                            | actor/trip/ExpenseInput → shares/obligations/FX         | read-only validation/plan; ไม่มี INSERT/UPDATE                  |
| ExpensesService.create/update/remove               | actor/trip/input → ExpenseView/deleted                  | Expense/shares/obligations/FX atomic; paid lock                 |
| ExpensesService.detail/listDay                     | actor/trip/expense or day → output                      | read-only batch model                                           |
| ExpensesService.plan/assertUnpaid                  | transaction/input/previous → calculated plan หรือ error | private: metadata validation, pure split/FX math, paid check    |
| ObligationsService.preview                         | actor/trip/obligation/currency → expectedPaidAmount     | read-only; ไม่เปลี่ยน status                                    |
| ObligationsService.settle/clear                    | actor/trip/obligation/input → ObligationView            | idempotent payment + settlement atomic                          |
| SummaryService.detail                              | actor/trip → summary                                    | snapshot เดียว; ไม่หักกลบยอดสวนทาง                              |
| CurrenciesService.list/require                     | ไม่มี/code + optional client → metadata                 | DB reference; ไม่มี cache/seed แอบแฝง                           |
| ExchangeRatesService.quote                         | actor/pair → signed quote                               | metadata + provider; อายุ 5 นาที                                |
| ExchangeRatesService.resolveRate/snapshot/sign     | selection/actor/pair/amount → rate/FX/signature         | ไม่มี network; อ่าน signing key/clock; manual ไม่เรียก provider |
| LambdaFxTransport.invoke/onApplicationShutdown     | function/payload → SDK result / void                    | AWS SDK + timeout; destroy client เมื่อปิดแอป                   |
| LambdaFxClient.rate                                | pair → validated decimal/capturedAt                     | invoke Lambda; ไม่คืน raw upstream errors                       |
| handler (Lambda)                                   | pair → rate/date หรือ error marker                      | fetch provider เฉพาะ pair; ไม่รับยอดเงิน/userId                 |
| HealthController.check                             | ไม่มี → readiness หรือ 503                              | SELECT 1 ไม่คืน credentials                                     |

## Repository I/O

ทุก repository method รับ client ของ transaction เดิมเมื่อทำหลายขั้น ไม่เปิด transaction ซ้อน Values ใช้ bind parameters ไม่มีชื่อ table/column จาก client เข้า SQL

| Repository / methods                                         | Input → Output                             | ตารางและผลข้างเคียง                                                                      |
| ------------------------------------------------------------ | ------------------------------------------ | ---------------------------------------------------------------------------------------- |
| TripsRepository.list/detail/readDetail                       | actor/trip/client → list/detail            | อ่าน owner-scoped trips/participants/days/expense totals; detail ใช้ consistent snapshot |
| TripsRepository.create                                       | actor/DTO → TripDetail                     | lock users, count quota, create trips/owner/day atomic                                   |
| TripLifecycleRepository.deleted/run/activeCount              | actor/id/callback → list/result/count      | owner lock ก่อน trip เพื่อใช้ protocol เดียวกับ create                                   |
| TripLifecycleRepository.remove/restore/update/expenseAmounts | client/id/values → result/void/amount rows | trips + expense read; service คุม snapshot changes                                       |
| ParticipantsRepository.create/update/remove                  | client/trip/id/name → DTO/deleted          | participants; refuse owner/reference deletion                                            |
| TripDaysRepository.create/update                             | client/trip/id/name → DTO                  | trip_days; caller lock trip; unique conflict → AOK-4102                                  |
| ExpensesRepository.requireDay/people                         | client/trip/id → void/people               | membership checks ภายในทริป                                                              |
| ExpensesRepository.create/update/remove                      | client/DTO/id → id/void                    | expenses; caller คุม paid lock และ transaction                                           |
| ExpensesRepository.replaceSplit                              | client/expense/payer/shares → void         | replace shares; upsert obligations ของ debtor เดิมและลบเฉพาะที่ออกจากวงหาร               |
| ExpenseReadRepository.list/require/obligation                | client/trip/base/filter → views            | batch expense/share/FX/settlement read; ไม่มี network provider                           |
| ExpenseSnapshotRepository.replace                            | client/expense/snapshot → void             | เก็บประวัติ; current=false ของเดิมแล้ว INSERT ใหม่                                       |
| ObligationsRepository.settle/clear                           | client/obligation/payment/FX → void        | status + obligation_settlements ใน transaction ของ service                               |
| DatabaseService.query/transaction                            | SQL/values หรือ callback/readOnly → result | pool กลาง, commit/rollback/release/discard                                               |
| DatabaseService.database/onApplicationShutdown               | ไม่มี → pool/void                          | config guard และปิด pool                                                                 |

Controller methods เป็น HTTP wrappers รับ request/DTO/id/query และคืนผล service แต่ละชื่อ method ตรง use case ข้างบน Test scenarios ตรวจผล API/domain/SQL ที่สังเกตได้ ไม่ต้อง mock เมธอด private

## Dependency และ cost of change

- API module ประกอบ providers ของ feature เอง ไม่สร้าง abstract repository/interface ซ้ำโดยไม่มีผู้ใช้ที่สอง
- feature ลูกใช้ TripAccessService สำหรับสิทธิ์และ transaction ร่วมกัน ไม่ผูกกับ HTTP cookie และไม่ inject request object ลง service
- ExpenseReadRepository เป็น read model ที่ Summary/Obligations ใช้ร่วมกัน เพื่อให้ format เงิน/FX/status สอดคล้องกันโดยไม่คัดลอก SQL
- ExchangeRatesModule ไม่ import Trips/Expenses จึงไม่มี dependency วน; transport mock ผ่าน FX_INVOKE token เปลี่ยน provider ภายใน Lambda ได้โดยไม่แก้กฎเงิน
- การคำนวณเงิน pure อยู่ common/money และ expense-calculations การเปลี่ยนกฎหาร/ปัดเศษตรวจได้ด้วยชุด input/output โดยไม่เปิด database
- Pool สูงสุด 5 connections ต่อ API process ไม่มี pool ตาม feature; ไม่มี provider call ขณะถือ write transaction ไม่มีการ optimize/cache ล่วงหน้า
- ขณะนี้ OAuth flow/rate limit อยู่ใน memory ต่อ instance ก่อน scale auth หลาย instance ต้องใช้ shared storage; FX quote ใช้ shared signing secret จึงตรวจข้าม API instance/restart ได้เมื่อใช้ key เดียวกัน

Dependency security: pin multer 2.5.0 ผ่าน scoped override ของ @nestjs/platform-express เพราะรุ่น 2.4.0 ที่ Nest pin อยู่มี [GHSA-q7qp-rjg7-q26m](https://github.com/advisories/GHSA-q7qp-rjg7-q26m) ไม่มีการ downgrade Nest เพื่อตามคำแนะนำ audit แบบ force
