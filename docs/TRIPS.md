# Trips

Trips มีครบ 7 เส้นตาม MVP: อ่านรายการ สร้าง อ่านรายละเอียด แก้ไข soft delete อ่านทริปที่ลบ และกู้คืนภายใน 30 วัน

อ่านสัญญา request/response ใน [API.md](API.md) และตาราง function input/output/purity/dependencies ใน [FUNCTIONS.md](FUNCTIONS.md)

- `trips.controller/service/repository/dto` ดูแล list/create/detail
- `trip-lifecycle.controller/service/repository/dto` ดูแล patch/delete/deleted/restore
- `trip-access.service` เป็น transaction/owner boundary ที่ feature ลูกใช้ร่วมกัน
- create/restore ล็อกแถว owner เดียวกันก่อนตรวจโควตา 5 ทริป
- writes ของ feature ลูกล็อก trip เพื่อกันแข่งกับ base currency changes/delete/settlements
- read detail/summary ใช้ snapshot เดียว ไม่อ่าน participants/days/ยอดเงินคนละสถานะ
- เปลี่ยน base currency เก็บ snapshot เก่าและไม่แก้ยอดต้นทางหรือ settlement

Tests อยู่ `test/trips/` และ flow ร่วมกับ features อื่นใน `test/expenses/` และ `test/summary/` โดยไม่เปิด server หรือแตะ Supabase จริง HTTP journey เตรียมไว้ใน `test/business/business.e2e-spec.ts` ให้รันเองเมื่อพร้อม
