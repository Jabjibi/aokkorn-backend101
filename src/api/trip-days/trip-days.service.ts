import { Inject, Injectable } from '@nestjs/common';
import { TripAccessService } from '../trips/trip-access.service.js';
import { TripDaysRepository } from './trip-days.repository.js';

/** I/O: actor/trip/input → day; owner filter และ row lock มาก่อนการเปลี่ยนวัน */
@Injectable()
export class TripDaysService {
  constructor(
    @Inject(TripAccessService) private readonly access: TripAccessService,
    @Inject(TripDaysRepository) private readonly repository: TripDaysRepository,
  ) {}

  create(ownerId: string, tripId: string, input: { name?: string }) {
    return this.access.run(ownerId, tripId, true, (client) =>
      this.repository.create(client, tripId, input.name),
    );
  }

  update(ownerId: string, tripId: string, id: string, input: { name: string }) {
    return this.access.run(ownerId, tripId, true, (client) =>
      this.repository.update(client, tripId, id, input.name),
    );
  }
}
