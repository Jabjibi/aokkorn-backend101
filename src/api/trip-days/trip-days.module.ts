import { Module } from '@nestjs/common';
import { TripsModule } from '../trips/trips.module.js';
import { LineLoginModule } from '../line-login/line-login.module.js';
import { TripDaysController } from './trip-days.controller.js';
import { TripDaysService } from './trip-days.service.js';
import { TripDaysRepository } from './trip-days.repository.js';

@Module({
  imports: [TripsModule, LineLoginModule],
  controllers: [TripDaysController],
  providers: [TripDaysService, TripDaysRepository],
})
export class TripDaysModule {}
