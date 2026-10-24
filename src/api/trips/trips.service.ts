import { Inject, Injectable } from '@nestjs/common';
import { TripsRepository } from './trips.repository.js';
import {
  TRIP_LIMIT,
  totalsByCurrency,
  type CreateTripInput,
} from './trips.dto.js';

/** Use cases: actor มาจาก SessionGuard; ไม่อ่าน cookies/SQL/process.env ใน service */
@Injectable()
export class TripsService {
  constructor(
    @Inject(TripsRepository) private readonly repository: TripsRepository,
  ) {}

  /** I/O: ownerId → รายการทริปพร้อมโควตาและยอดแยกสกุล; อ่านผ่าน repository */
  async list(ownerId: string) {
    const items = await this.repository.list(ownerId);
    return {
      items,
      quota: {
        used: items.length,
        limit: TRIP_LIMIT,
        remaining: Math.max(0, TRIP_LIMIT - items.length),
      },
      totalsByCurrency: totalsByCurrency(items),
    };
  }

  /** I/O: ownerId + DTO ที่ผ่าน pipe → รายละเอียดทริปใหม่; repository ดูแล atomic write */
  create(ownerId: string, input: CreateTripInput) {
    return this.repository.create(ownerId, input);
  }

  /** I/O: ownerId + tripId → รายละเอียด หรือ 404; ไม่มีข้อมูลผู้ใช้อื่นหลุดออกมา */
  detail(ownerId: string, tripId: string) {
    return this.repository.detail(ownerId, tripId);
  }
}
