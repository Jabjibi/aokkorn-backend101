import { Inject, Injectable } from '@nestjs/common';
import { TripAccessService } from '../trips/trip-access.service.js';
import { ParticipantsRepository } from './participants.repository.js';

/** I/O use cases: actor + trip/id/input → public result; ตรวจ owner ก่อน repository เสมอ */
@Injectable()
export class ParticipantsService {
  constructor(
    @Inject(TripAccessService) private readonly access: TripAccessService,
    @Inject(ParticipantsRepository)
    private readonly repository: ParticipantsRepository,
  ) {}

  create(ownerId: string, tripId: string, input: { displayName: string }) {
    return this.access.run(ownerId, tripId, true, (client) =>
      this.repository.create(client, tripId, input.displayName),
    );
  }

  update(
    ownerId: string,
    tripId: string,
    id: string,
    input: { displayName: string },
  ) {
    return this.access.run(ownerId, tripId, true, (client) =>
      this.repository.update(client, tripId, id, input.displayName),
    );
  }

  remove(ownerId: string, tripId: string, id: string) {
    return this.access.run(ownerId, tripId, true, (client) =>
      this.repository.remove(client, tripId, id),
    );
  }
}
