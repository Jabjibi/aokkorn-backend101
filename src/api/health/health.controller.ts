import { Controller, Get, Inject } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service.js';
import { ApiError, ERRORS } from '../../common/api-error.filter.js';

/** I/O readiness สำหรับ Render: ตรวจ SELECT 1 เท่านั้น ไม่สร้างตารางหรือส่ง connection details */
@Controller('health')
export class HealthController {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  /**
   * GET /health
   * รับ: ไม่มี ไม่ต้องเข้าสู่ระบบ
   * คืน: สถานะ database readiness หรือ 503
   */
  @Get()
  async check() {
    try {
      await this.db.query('SELECT 1');
      return { status: 'ok', database: 'up' };
    } catch {
      throw new ApiError(
        ERRORS.HEALTH_UNAVAILABLE,
        'ฐานข้อมูลยังไม่พร้อมใช้งาน',
      );
    }
  }
}
