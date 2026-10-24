import { Module } from '@nestjs/common';
import { TripsModule } from '../trips/trips.module.js';
import { LineLoginModule } from '../line-login/line-login.module.js';
import { ParticipantsController } from './participants.controller.js';
import { ParticipantsService } from './participants.service.js';
import { ParticipantsRepository } from './participants.repository.js';

@Module({
  imports: [TripsModule, LineLoginModule],
  controllers: [ParticipantsController],
  providers: [ParticipantsService, ParticipantsRepository],
})
export class ParticipantsModule {}
